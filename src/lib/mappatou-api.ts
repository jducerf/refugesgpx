import { z } from 'zod';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { readCache, writeCache } from './cache';

/**
 * MapPatou — zones pastorales (Unités Pastorales) + présence de chiens de
 * protection (patous). Données : Pasto-Kezako / LESSEM (INRAE).
 *
 * Particularités vérifiées sur l'API réelle (la doc fournie était fausse sur
 * le point n°1) :
 *  - Le paramètre `date` du POST **est bien pris en compte côté serveur**,
 *    contrairement à ce qu'affirmait la doc. L'API renvoie toujours les ~5057
 *    géométries (~4,8 Mo, non gzippé), mais `debut`/`fin`/`chiens`/`type_animal`
 *    /jours reflètent la **période d'estive active à la date demandée** (champs
 *    nuls si l'UP n'est pas pâturée ce jour-là). C'est donc l'API qui filtre la
 *    date → on fetch par date et on re-fetch quand l'utilisateur la change.
 *  - CORS : l'API **reflète l'Origin** + `allow-credentials` → pas besoin de
 *    proxy serveur, l'appel passe directement depuis le navigateur.
 *  - `surface` n'est PAS une surface en hectares : c'est une chaîne (un nom de
 *    zone parente), à ne jamais afficher comme une superficie.
 *  - `type_animal` a une casse incohérente (`bovins` ET `Bovins`) → normaliser.
 */

const MAPPATOU_API = 'https://mappatous-api.lessem.inrae.fr/api/v1/map/geojson';

const CACHE_PREFIX = 'mappatou';
/** Donnée saisonnière, bouge peu → on garde 7 jours (cache par date demandée). */
const MAPPATOU_TTL = 7 * 24 * 60 * 60 * 1000;

export const MAPPATOU_ATTRIBUTION =
  'Zones pastorales : © <a href="https://www.pasto-kezako.fr/mappatou-carte/" target="_blank" rel="noopener">Pasto-Kezako</a> / LESSEM (INRAE)';

/**
 * Drapeau de disponibilité de la couche pastorale.
 *
 * Désactivée en **production** tant que la licence MapPatou n'est pas confirmée
 * auprès de Pasto-Kezako ; active en **dev** pour pouvoir continuer à tester.
 * En prod le drapeau vaut `false` → la couche est totalement inerte : pas d'UI,
 * pas d'appel à l'API, pas de source ni d'attribution sur la carte.
 *
 * Pour la réactiver en prod une fois l'accord obtenu, sans toucher au code :
 * poser la variable d'environnement Netlify `PUBLIC_PASTORAL_LAYER=true` et
 * redéployer (Vite expose les variables préfixées `PUBLIC_` au client).
 */
export const PASTORAL_FEATURE_ENABLED =
  import.meta.env.PUBLIC_PASTORAL_LAYER === 'true' || !!import.meta.env.DEV;

export interface MapPatouProperties {
  id?: string;
  nom?: string | null;
  /** Chaîne libre — duplique souvent `nom`, jamais une surface numérique. */
  surface?: unknown;
  type_animal?: string | null;
  chiens?: boolean;
  debut?: string | null; // YYYY-MM-DD
  fin?: string | null; // YYYY-MM-DD
  lundi?: boolean;
  mardi?: boolean;
  mercredi?: boolean;
  jeudi?: boolean;
  vendredi?: boolean;
  samedi?: boolean;
  dimanche?: boolean;
  [k: string]: unknown;
}

export type MapPatouFeature = Feature<MultiPolygon, MapPatouProperties>;
export type MapPatouCollection = FeatureCollection<
  MultiPolygon,
  MapPatouProperties
>;

/**
 * On valide uniquement l'enveloppe (cheap). On NE fait PAS de validation Zod
 * profonde des 5057 géométries MultiPolygon : ce serait coûteux pour aucun
 * gain (la donnée est du GeoJSON standard, consommé tel quel par MapLibre).
 * Les propriétés sont lues de façon défensive au moment du rendu.
 */
const EnvelopeSchema = z.looseObject({
  success: z.boolean().optional(),
  data: z.looseObject({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()),
  }),
});

// Mémo module, indexé par date demandée : évite de relire/parser IndexedDB à
// chaque re-sélection d'une même date dans la session.
const _memo = new Map<string, MapPatouCollection>();

/** Date du jour locale au format YYYY-MM-DD (sans dérive UTC). */
export function localTodayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Récupère le jeu MapPatou **pour une date donnée** (l'API filtre la période
 * d'estive côté serveur). Cache : mémo module → IndexedDB (clé = date, TTL 7 j)
 * → réseau.
 */
export async function fetchMapPatou(
  date: string,
  signal?: AbortSignal,
): Promise<MapPatouCollection> {
  const memoized = _memo.get(date);
  if (memoized) return memoized;

  const cached = await readCache<MapPatouCollection>(
    CACHE_PREFIX,
    date,
    MAPPATOU_TTL,
  );
  if (cached) {
    _memo.set(date, cached);
    return cached;
  }

  const res = await fetch(MAPPATOU_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
    signal,
  });
  if (!res.ok) throw new Error(`MapPatou API → ${res.status}`);

  const json = await res.json();
  const env = EnvelopeSchema.parse(json);
  const fc = env.data as unknown as MapPatouCollection;

  _memo.set(date, fc);
  void writeCache(CACHE_PREFIX, date, fc);
  return fc;
}

const JOURS = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
] as const;

/**
 * Une UP est-elle active à la date demandée ?
 *
 * Le jeu a été fetché POUR cette date : l'API renseigne `debut`/`fin` (et les
 * jours) uniquement pour les UP pâturées ce jour-là, et les laisse nulles
 * sinon. Donc `debut`/`fin` absents ⇒ UP inactive à cette date ⇒ on masque.
 * On revérifie tout de même l'appartenance à la fenêtre et au jour de semaine
 * par sécurité (et au cas où `date` passée ≠ date du fetch).
 */
export function isUpActiveOn(p: MapPatouProperties, dateStr: string): boolean {
  if (!p.debut || !p.fin) return false;
  if (dateStr < p.debut || dateStr > p.fin) return false;
  // Date locale construite depuis les composants → pas de dérive de fuseau.
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;
  const jour = JOURS[new Date(y, m - 1, d).getDay()];
  if (p[jour] === false) return false;
  return true;
}

const ANIMAL_LABELS: Record<string, string> = {
  bovins: 'Bovins',
  ovins: 'Ovins',
  caprins: 'Caprins',
  equins: 'Équins',
  asins: 'Asins',
  mixte: 'Troupeau mixte',
};

/** Normalise `type_animal` (casse incohérente dans la source) en libellé FR. */
export function animalLabel(raw: string | null | undefined): string {
  if (!raw) return 'Non renseigné';
  const key = raw.trim().toLowerCase();
  return ANIMAL_LABELS[key] ?? raw;
}

/** Résumé lisible des jours de présence ("tous les jours" / "lun, mar, …"). */
export function presentDaysSummary(p: MapPatouProperties): string {
  const short: Record<(typeof JOURS)[number], string> = {
    lundi: 'lun',
    mardi: 'mar',
    mercredi: 'mer',
    jeudi: 'jeu',
    vendredi: 'ven',
    samedi: 'sam',
    dimanche: 'dim',
  };
  const order: (typeof JOURS)[number][] = [
    'lundi',
    'mardi',
    'mercredi',
    'jeudi',
    'vendredi',
    'samedi',
    'dimanche',
  ];
  const present = order.filter((j) => p[j] !== false);
  if (present.length === 7) return 'tous les jours';
  if (present.length === 0) return '—';
  return present.map((j) => short[j]).join(', ');
}
