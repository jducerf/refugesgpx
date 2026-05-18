import type { Feature, Point, LineString, Polygon } from 'geojson';

export interface TrackPoint {
  lon: number;
  lat: number;
  ele?: number;
}

export interface ParsedGpx {
  name: string;
  points: TrackPoint[];
}

export interface PoiProperties {
  id?: number;
  nom: string;
  type?: {
    id?: number;
    valeur: string;
    icone?: string;
  };
  coord?: { alt?: number };
  lien?: string;
  places?: { nom?: string; valeur?: number; nb?: number };
  etat?: { valeur: string };
  [key: string]: unknown;
}

export type PoiFeature = Feature<Point, PoiProperties>;
export type TraceLineFeature = Feature<LineString>;
export type BufferPolygonFeature = Feature<Polygon>;

export type PoiSource = 'refuges' | 'osm' | 'c2c';

export interface PoiCandidate {
  feature: PoiFeature;
  distM: number;
  id: number;
  source: PoiSource;
}

export interface Comment {
  id_commentaire: number;
  id_point: number;
  date_commentaire: string;
  texte_commentaire: string;
  auteur_commentaire: string;
  'photo-vignette'?: string;
  'photo-reduite'?: string;
  'photo-originale'?: string;
}

export interface FicheData {
  feature: PoiFeature;
  comments: Comment[];
}

// ─── Types de POIs ──────────────────────────────────────────────────
// Pour chaque type : libellé, valeur API, couleur de marqueur et `iconKey`
// référençant un composant Lucide (chargé côté UI dans `<TypeIcon />`).

export interface TypeMeta {
  id: number;
  label: string;
  valeurAPI: string;
  color: string;
  /** Clé d'icône Lucide consommée par <TypeIcon /> */
  iconKey: 'home' | 'tent' | 'bed' | 'droplet' | 'alert' | 'waves' | 'mountain' | 'bag';
  /** Path SVG (inner of <g>) pour marker de carte rasterizé */
  svgPath: string;
}

const LUCIDE_PATHS: Record<TypeMeta['iconKey'], string> = {
  // House
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  // Tent
  tent: '<path d="M3.5 21 14 3"/><path d="M20.5 21 14 3"/><path d="M3.5 21h17"/><path d="M12 12v9"/>',
  // BedDouble
  bed: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  // Droplet
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  // TriangleAlert
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  // Waves (Lucide) — utilisé pour les sources OSM (distinction visuelle vs pt_eau refuges.info)
  waves:
    '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  // Mountain (Lucide) — utilisé pour les bivouacs Camptocamp
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  // ShoppingBag (Lucide) — ravitaillement / commerces OSM en village
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
};

export const TYPE_LABELS = {
  refuge: {
    id: 10,
    label: 'Refuges gardés',
    valeurAPI: 'refuge gardé',
    color: '#B85C38', // accent rouge
    iconKey: 'home',
    svgPath: LUCIDE_PATHS.home,
  },
  cabane: {
    id: 7,
    label: 'Cabanes non gardées',
    valeurAPI: 'cabane non gardée',
    color: '#5E6F4A', // vert mousse
    iconKey: 'tent',
    svgPath: LUCIDE_PATHS.tent,
  },
  gite: {
    id: 9,
    label: "Gîtes d'étape",
    valeurAPI: "gîte d'étape",
    color: '#6F4E8E', // violet
    iconKey: 'bed',
    svgPath: LUCIDE_PATHS.bed,
  },
  pt_eau: {
    id: 23,
    label: "Points d'eau",
    valeurAPI: "point d'eau",
    color: '#2C7DA0', // bleu eau
    iconKey: 'droplet',
    svgPath: LUCIDE_PATHS.droplet,
  },
  pt_passage: {
    id: 3,
    label: 'Passages délicats',
    valeurAPI: 'passage délicat',
    color: '#DDA853', // jaune trail
    iconKey: 'alert',
    svgPath: LUCIDE_PATHS.alert,
  },
  // ─── Sources annexes ────────────────────────────────────────────
  osm_water: {
    id: -1,
    label: 'Sources / eau (OSM)',
    valeurAPI: 'osm_water',
    color: '#4FA8C5', // cyan plus clair que pt_eau (distinction visuelle)
    iconKey: 'waves',
    svgPath: LUCIDE_PATHS.waves,
  },
  c2c_bivouac: {
    id: -2,
    label: 'Bivouacs (Camptocamp)',
    valeurAPI: 'c2c_bivouac',
    color: '#8B6F47', // brun bois
    iconKey: 'mountain',
    svgPath: LUCIDE_PATHS.mountain,
  },
  osm_shop: {
    id: -3,
    label: 'Ravitaillement (OSM)',
    valeurAPI: 'osm_shop',
    color: '#0F766E', // teal foncé, distinct du bleu eau et du brun bivouac
    iconKey: 'bag',
    svgPath: LUCIDE_PATHS.bag,
  },
} as const satisfies Record<string, TypeMeta>;

export type TypeKey = keyof typeof TYPE_LABELS;

export const ALL_TYPE_KEYS: TypeKey[] = Object.keys(TYPE_LABELS) as TypeKey[];

/** Types issus de refuges.info (filtre principal) */
export const REFUGES_TYPE_KEYS: TypeKey[] = [
  'refuge',
  'cabane',
  'gite',
  'pt_eau',
  'pt_passage',
];

/** Types issus de sources annexes (toggle séparé, opt-in) */
export const ANNEX_TYPE_KEYS: TypeKey[] = ['osm_water', 'c2c_bivouac', 'osm_shop'];

const VALEUR_TO_META: Record<string, TypeMeta> = Object.fromEntries(
  Object.values(TYPE_LABELS).map((t) => [t.valeurAPI, t]),
);

export function getTypeMeta(typeValeur: string | undefined): TypeMeta | null {
  if (!typeValeur) return null;
  return VALEUR_TO_META[typeValeur] ?? null;
}

export interface BufferStep {
  meters: number;
  label: string;
}

export const BUFFER_STEPS: BufferStep[] = [
  { meters: 100, label: '100 m' },
  { meters: 200, label: '200 m' },
  { meters: 500, label: '500 m' },
  { meters: 1000, label: '1 km' },
  { meters: 2000, label: '2 km' },
  { meters: 3000, label: '3 km' },
  { meters: 5000, label: '5 km' },
];
