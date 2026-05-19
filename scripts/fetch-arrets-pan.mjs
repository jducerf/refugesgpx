#!/usr/bin/env node
/**
 * Télécharge la "Base nationale consolidée des arrêts de transport en commun"
 * publiée sur transport.data.gouv.fr (Point d'Accès National, agrégat des
 * GTFS publics français : TER, Cars Région, navettes estivales, réseaux
 * urbains…), dédoublonne les arrêts qui apparaissent dans plusieurs jeux
 * GTFS, et écrit un GeoJSON par département dans
 * public/data/arrets-pan/<code-dept>.geojson, accompagné d'un index.json.
 *
 * Usage :
 *   node scripts/fetch-arrets-pan.mjs                  # tous départements
 *   node scripts/fetch-arrets-pan.mjs --dept 74        # 1 département (POC)
 *   node scripts/fetch-arrets-pan.mjs --dept 73,74,38  # plusieurs
 *
 * Source : https://transport.data.gouv.fr/datasets/arrets-de-transport-en-france
 * Licence : Licence Ouverte 2.0 (Etalab) — attribution "transport.data.gouv.fr".
 *
 * Notes techniques
 *  - Le CSV upstream pèse ~400 MB, contient ~500 000 lignes. On stream le
 *    téléchargement vers un fichier temporaire, puis on parse en streaming
 *    (state-machine caractère par caractère) pour éviter de charger tout
 *    en mémoire.
 *  - Le CSV n'a pas de colonne département : on télécharge les contours
 *    simplifiés des dépts (Etalab, ~200 KB) et on fait du point-in-polygon
 *    par ray-casting. Pas de nouvelle dépendance.
 *  - Le dataset prévient explicitement que les arrêts ne sont pas dédoublonnés
 *    (un même arrêt physique peut apparaître dans TER + Cars Région + réseau
 *    urbain). On dédoublonne sur (lat arrondie à 4 décimales, lon idem, nom
 *    normalisé) ; les noms d'agence sont accumulés dans un tableau.
 */
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'data', 'arrets-pan');

const CSV_URL = 'https://transport.data.gouv.fr/resources/81333/download';
const CONTOURS_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson';
const TMP_CSV = resolve(tmpdir(), 'arrets-pan.csv');

// ─── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let deptFilter = null; // Set<string> | null (null = tous)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dept') {
    const v = args[i + 1];
    if (!v) {
      console.error('--dept attend une valeur (ex: 74 ou 73,74,38)');
      process.exit(1);
    }
    deptFilter = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
    i++;
  }
}

// ─── Utils ─────────────────────────────────────────────────────────────

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

/** Normalise un nom d'arrêt pour la clé de dédup. Casse + diacritiques +
 * espaces multiples. On garde les chiffres et lettres. */
function normName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ray-casting point-in-polygon. `poly` est un tableau d'anneaux (1er =
 * extérieur, suivants = trous). Chaque anneau est [[lon, lat], …]. */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, polygon) {
  // polygon = array of rings ; outer first, holes after
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

function pointInGeometry(lon, lat, geom) {
  if (geom.type === 'Polygon') return pointInPolygon(lon, lat, geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (pointInPolygon(lon, lat, poly)) return true;
    }
    return false;
  }
  return false;
}

function bboxOf(geom) {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  const visit = (rings) => {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  };
  if (geom.type === 'Polygon') visit(geom.coordinates);
  else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates) visit(p);
  return [w, s, e, n];
}

/** Parser CSV streaming, robuste aux frontières de chunk et aux champs
 * multi-lignes entre quotes. Yield un tableau de champs par ligne. */
class CsvStreamParser {
  constructor() {
    this.inQuotes = false;
    this.field = '';
    this.row = [];
    this.pendingQuote = false; // on a vu un " en mode quotes, on attend le char suivant
  }
  *feed(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') {
          this.field += '"';
          continue;
        } else {
          this.inQuotes = false;
          // on retombe sur le traitement non-quote
        }
      }
      if (this.inQuotes) {
        if (c === '"') {
          this.pendingQuote = true;
        } else {
          this.field += c;
        }
      } else {
        if (c === '"') {
          this.inQuotes = true;
        } else if (c === ',') {
          this.row.push(this.field);
          this.field = '';
        } else if (c === '\n') {
          this.row.push(this.field);
          yield this.row;
          this.row = [];
          this.field = '';
        } else if (c === '\r') {
          // ignore
        } else {
          this.field += c;
        }
      }
    }
  }
  *flush() {
    if (this.field !== '' || this.row.length) {
      this.row.push(this.field);
      yield this.row;
    }
  }
}

// ─── Pipeline ──────────────────────────────────────────────────────────

console.log('Téléchargement des contours dépts (Etalab, simplifiés)…');
const contoursRes = await fetch(CONTOURS_URL);
if (!contoursRes.ok) throw new Error(`Contours dépts → HTTP ${contoursRes.status}`);
const contoursFc = await contoursRes.json();
const depts = [];
for (const f of contoursFc.features) {
  const code = f.properties?.code;
  if (!code) continue;
  if (deptFilter && !deptFilter.has(code)) continue;
  depts.push({
    code,
    nom: f.properties?.nom ?? code,
    geom: f.geometry,
    bbox: bboxOf(f.geometry), // pré-calcul pour éviter le ray-casting si hors bbox
    stops: new Map(), // dedupKey -> stop
  });
}
console.log(`  ${depts.length} département(s) chargés${deptFilter ? ' (filtre actif)' : ''}.`);

// Téléchargement CSV → fichier temp (streaming)
let needDownload = true;
try {
  const st = await stat(TMP_CSV);
  // Si déjà téléchargé dans les dernières 24h, on garde
  const ageH = (Date.now() - st.mtimeMs) / 1000 / 3600;
  if (ageH < 24) {
    console.log(
      `CSV temp existant trouvé (${(st.size / 1024 / 1024).toFixed(1)} MB, ${ageH.toFixed(
        1,
      )}h) → réutilisation. Supprimer ${TMP_CSV} pour forcer un re-download.`,
    );
    needDownload = false;
  }
} catch {
  // pas de cache
}

if (needDownload) {
  console.log(`Téléchargement CSV (${CSV_URL})…`);
  const start = Date.now();
  const csvRes = await fetch(CSV_URL, { redirect: 'follow' });
  if (!csvRes.ok) throw new Error(`CSV → HTTP ${csvRes.status}`);
  if (!csvRes.body) throw new Error('CSV : pas de body');
  await pipeline(Readable.fromWeb(csvRes.body), createWriteStream(TMP_CSV));
  const st = await stat(TMP_CSV);
  console.log(
    `  ✓ ${(st.size / 1024 / 1024).toFixed(1)} MB téléchargés en ${(
      (Date.now() - start) /
      1000
    ).toFixed(1)}s → ${TMP_CSV}`,
  );
}

// Parse + filter + dedup + bind to dept
console.log('Parsing CSV streaming…');
const parser = new CsvStreamParser();
const stream = createReadStream(TMP_CSV, { encoding: 'utf8' });

let header = null;
let idx = null;
let nRead = 0;
let nKept = 0;
let nNoDept = 0;
let nDup = 0;
const parseStart = Date.now();

function processRow(row) {
  if (!header) {
    header = row;
    idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    const required = [
      'stop_name',
      'stop_lat',
      'stop_lon',
      'location_type',
      'dataset_custom_title',
    ];
    for (const col of required) {
      if (!(col in idx)) throw new Error(`Colonne manquante dans le CSV : "${col}"`);
    }
    return;
  }
  nRead++;
  if (nRead % 50000 === 0) {
    process.stdout.write(
      `  ${nRead} lignes parcourues, ${nKept} arrêts retenus…\r`,
    );
  }

  const lat = parseFloat(row[idx.stop_lat]);
  const lon = parseFloat(row[idx.stop_lon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  // location_type GTFS : "" ou "0" = arrêt, "1" = station mère, "2" = entrée,
  // "3" = nœud, "4" = espace boarding. On garde 0 (arrêts) et 1 (gares/pôles).
  const lt = row[idx.location_type] ?? '';
  if (lt !== '' && lt !== '0' && lt !== '1') return;

  // Pré-filtre bbox France élargie pour ignorer les arrêts hors-pays
  // (certaines GTFS frontalières en publient).
  if (lat < 41 || lat > 51.5 || lon < -5.5 || lon > 10) return;

  // Recherche du département (point-in-polygon avec pré-filtre bbox)
  let dept = null;
  for (const d of depts) {
    const [w, s, e, n] = d.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (pointInGeometry(lon, lat, d.geom)) {
      dept = d;
      break;
    }
  }
  if (!dept) {
    nNoDept++;
    return;
  }

  const name = (row[idx.stop_name] ?? '').trim();
  if (!name) return;

  // On préfère `dataset_custom_title` (1 valeur par GTFS source, propre) à
  // `agency_name` qui dans plusieurs GTFS multi-réseaux (cars Région) concatène
  // 40+ partenaires par ";". L'idée est de répondre à la question "quel(s)
  // réseau(x) desservent cet arrêt ?" → l'identifiant du GTFS source est plus
  // significatif que le champ agency interne.
  const network = (row[idx.dataset_custom_title] ?? '').trim();

  const dedupKey = `${round5(lat).toFixed(5)}|${round5(lon).toFixed(5)}|${normName(name)}`;
  const existing = dept.stops.get(dedupKey);
  if (existing) {
    nDup++;
    if (network && !existing.ag.includes(network) && existing.ag.length < 5) {
      existing.ag.push(network);
    }
    return;
  }
  dept.stops.set(dedupKey, {
    nom: name,
    lat: round5(lat),
    lon: round5(lon),
    ag: network ? [network] : [],
    lt: lt === '1' ? 1 : 0,
  });
  nKept++;
}

for await (const chunk of stream) {
  for (const row of parser.feed(chunk)) processRow(row);
}
for (const row of parser.flush()) processRow(row);

console.log(); // newline
console.log(
  `  ✓ ${nRead} lignes parcourues en ${((Date.now() - parseStart) / 1000).toFixed(1)}s`,
);
console.log(`    ${nKept} arrêts retenus · ${nDup} doublons fusionnés · ${nNoDept} hors zone (autres dépts ou hors France)`);

// Nettoyage du dossier de sortie : on supprime seulement les .geojson des
// dépts qu'on va régénérer, pour ne pas écraser un asset partiel en POC.
await mkdir(OUT_DIR, { recursive: true });
if (!deptFilter) {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
}

const indexEntries = [];
let totalBytes = 0;
const sorted = depts.slice().sort((a, b) => a.code.localeCompare(b.code));
for (const d of sorted) {
  if (d.stops.size === 0) continue;
  const features = [];
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const stop of d.stops.values()) {
    if (stop.lon < w) w = stop.lon;
    if (stop.lon > e) e = stop.lon;
    if (stop.lat < s) s = stop.lat;
    if (stop.lat > n) n = stop.lat;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
      properties: {
        nom: stop.nom,
        ag: stop.ag,
        lt: stop.lt,
        dept: d.code,
      },
    });
  }
  const fc = { type: 'FeatureCollection', features };
  const payload = JSON.stringify(fc);
  await writeFile(resolve(OUT_DIR, `${d.code}.geojson`), payload, 'utf8');
  totalBytes += payload.length;
  indexEntries.push({
    dept: d.code,
    nom: d.nom,
    count: features.length,
    bbox: [round5(w), round5(s), round5(e), round5(n)],
    kb: Math.round(payload.length / 1024),
  });
}

// Si on est en mode --dept, on fusionne avec l'index existant pour ne pas
// perdre les autres dépts déjà générés. Sinon on remplace.
let mergedIndex = indexEntries;
if (deptFilter) {
  try {
    const existing = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        resolve(OUT_DIR, 'index.json'),
        'utf8',
      ),
    );
    const map = new Map(existing.departments.map((d) => [d.dept, d]));
    for (const e of indexEntries) map.set(e.dept, e);
    mergedIndex = [...map.values()].sort((a, b) => a.dept.localeCompare(b.dept));
  } catch {
    // pas d'index existant
  }
}

const index = {
  source: 'transport.data.gouv.fr — Point d\'Accès National',
  dataset: 'https://transport.data.gouv.fr/datasets/arrets-de-transport-en-france',
  license: 'Licence Ouverte 2.0 (Etalab)',
  attribution: 'transport.data.gouv.fr',
  generated_at: new Date().toISOString(),
  count: mergedIndex.reduce((s, d) => s + d.count, 0),
  filter: 'location_type ∈ {0, 1} ; dédup (lat4, lon4, nom normalisé)',
  departments: mergedIndex,
};
await writeFile(resolve(OUT_DIR, 'index.json'), JSON.stringify(index), 'utf8');

console.log();
console.log(
  `✓ ${indexEntries.length} départements écrits · ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
);
console.log(`  index.json + ${indexEntries.length} fichiers dans ${OUT_DIR}`);
if (indexEntries.length <= 10) {
  for (const d of indexEntries) {
    console.log(`  ${d.dept} ${d.nom.padEnd(25)} ${d.count.toString().padStart(6)} arrêts · ${d.kb} KB`);
  }
} else {
  const top = indexEntries.slice().sort((a, b) => b.count - a.count).slice(0, 5);
  console.log('Top 5 dépts les plus volumineux :');
  for (const d of top) {
    console.log(`  ${d.dept} ${d.nom.padEnd(25)} ${d.count.toString().padStart(6)} arrêts · ${d.kb} KB`);
  }
}
