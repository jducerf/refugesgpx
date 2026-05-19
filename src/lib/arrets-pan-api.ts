import { z } from 'zod';
import type { PoiFeature } from './types';

/**
 * Charge les arrêts de transport en commun publiés sur le Point d'Accès
 * National (transport.data.gouv.fr), regénérés via
 * scripts/fetch-arrets-pan.mjs, en lecture statique, fichier par département.
 *
 * Architecture identique à datatourisme-api : index.json donne la liste des
 * départements + leur bbox réelle, on ne fetche que les dept dont la bbox
 * intersecte celle de la trace. Cache mémoire des fichiers déjà chargés.
 */

const BASE = '/data/arrets-pan';
const INDEX_URL = `${BASE}/index.json`;

/** Offset pour garder les IDs négatifs disjoints des autres sources annexes.
 * SNCF : 1e13, DT : 5e13. PAN : 1e14. */
const PAN_ID_OFFSET = 1e14;

const FeatureSchema = z.looseObject({
  type: z.literal('Feature'),
  geometry: z.looseObject({
    type: z.literal('Point'),
    coordinates: z.array(z.number()).min(2),
  }),
  properties: z.looseObject({
    nom: z.string(),
    ag: z.array(z.string()).default([]),
    lt: z.number().optional(), // location_type : 0 arrêt, 1 station mère
    dept: z.string().optional(),
  }),
});

const FCSchema = z.looseObject({
  type: z.literal('FeatureCollection'),
  features: z.array(FeatureSchema),
});

const IndexEntrySchema = z.looseObject({
  dept: z.string(),
  count: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  kb: z.number().optional(),
});

const IndexSchema = z.looseObject({
  departments: z.array(IndexEntrySchema),
});

export type Bbox = [number, number, number, number]; // [west, south, east, north]

interface DeptEntry {
  dept: string;
  count: number;
  bbox: Bbox;
}

/** Hash FNV-1a 32 bits sur la clé (dept + nom + lat + lon) pour un ID stable. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// ─── Cache ─────────────────────────────────────────────────────────────

let indexCache: DeptEntry[] | null = null;
let indexInflight: Promise<DeptEntry[]> | null = null;
const deptCache = new Map<string, PoiFeature[]>();
const deptInflight = new Map<string, Promise<PoiFeature[]>>();

async function loadIndex(signal?: AbortSignal): Promise<DeptEntry[]> {
  if (indexCache) return indexCache;
  if (indexInflight) return indexInflight;
  indexInflight = (async () => {
    const r = await fetch(INDEX_URL, { signal });
    if (!r.ok) throw new Error(`PAN index → ${r.status}`);
    const raw = await r.json();
    const parsed = IndexSchema.parse(raw);
    const out: DeptEntry[] = parsed.departments.map((d) => ({
      dept: d.dept,
      count: d.count,
      bbox: d.bbox as Bbox,
    }));
    indexCache = out;
    return out;
  })();
  try {
    return await indexInflight;
  } finally {
    indexInflight = null;
  }
}

async function loadDept(dept: string, signal?: AbortSignal): Promise<PoiFeature[]> {
  const cached = deptCache.get(dept);
  if (cached) return cached;
  const inflight = deptInflight.get(dept);
  if (inflight) return inflight;

  const p = (async () => {
    const r = await fetch(`${BASE}/${dept}.geojson`, { signal });
    if (!r.ok) throw new Error(`PAN dept ${dept} → ${r.status}`);
    const raw = await r.json();
    const parsed = FCSchema.parse(raw);
    const out: PoiFeature[] = [];
    for (const f of parsed.features) {
      const [lon, lat] = f.geometry.coordinates;
      const pp = f.properties;
      // ID stable basé sur (dept, lat, lon, nom) ; identique entre régénérations
      // tant que ces champs ne bougent pas.
      const key = `${dept}|${lat.toFixed(5)}|${lon.toFixed(5)}|${pp.nom}`;
      const id = -(fnv1a32(key) + PAN_ID_OFFSET);
      out.push({
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          id,
          nom: pp.nom,
          type: { id: -9, valeur: 'pan_arret' },
          panAgencies: pp.ag,
          panLocationType: pp.lt ?? 0,
          panDept: dept,
        },
      } as unknown as PoiFeature);
    }
    deptCache.set(dept, out);
    return out;
  })();

  deptInflight.set(dept, p);
  try {
    return await p;
  } finally {
    deptInflight.delete(dept);
  }
}

export async function fetchArretsPAN(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<PoiFeature[]> {
  const index = await loadIndex(signal);
  const needed = index.filter((d) => bboxIntersects(d.bbox, bbox));
  if (needed.length === 0) return [];

  const chunks = await Promise.all(needed.map((d) => loadDept(d.dept, signal)));
  const merged = chunks.flat();

  const [w, s, e, n] = bbox;
  return merged.filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return lon >= w && lon <= e && lat >= s && lat <= n;
  });
}
