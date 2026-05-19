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

export type PoiSource = 'refuges' | 'osm' | 'c2c' | 'sncf' | 'datatourisme' | 'pan';

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
  iconKey:
    | 'home'
    | 'tent'
    | 'bed'
    | 'droplet'
    | 'alert'
    | 'waves'
    | 'mountain'
    | 'bag'
    | 'train'
    | 'bed_single'
    | 'cross'
    | 'banknote'
    | 'toilet'
    | 'bus';
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
  // TrainFront (Lucide) — gares SNCF
  train:
    '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  // Bed (Lucide) — hébergements Datatourisme (distinct du BedDouble gîte refuges.info)
  bed_single:
    '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  // Cross (Lucide) — croix verte pharmacie OSM (amenity=pharmacy)
  cross:
    '<path d="M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z"/>',
  // Banknote (Lucide) — distributeurs OSM (amenity=atm)
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  // Toilet (Lucide) — toilettes publiques OSM (amenity=toilets)
  toilet:
    '<path d="M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18"/><path d="M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/>',
  // Bus (Lucide) — arrêts de transport en commun (PAN transport.data.gouv.fr)
  bus:
    '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
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
  sncf_gare: {
    id: -4,
    label: 'Gares SNCF',
    valeurAPI: 'sncf_gare',
    color: '#4338CA', // indigo, distinct des autres familles
    iconKey: 'train',
    svgPath: LUCIDE_PATHS.train,
  },
  dt_lodging: {
    id: -5,
    label: 'Hébergements (DATAtourisme)',
    valeurAPI: 'dt_lodging',
    color: '#A21E45', // cramoisi, distinct du violet gîte refuges.info et de l'indigo gare
    iconKey: 'bed_single',
    svgPath: LUCIDE_PATHS.bed_single,
  },
  osm_pharmacy: {
    id: -6,
    label: 'Pharmacies (OSM)',
    valeurAPI: 'osm_pharmacy',
    color: '#16A34A', // vert pharmacie iconique
    iconKey: 'cross',
    svgPath: LUCIDE_PATHS.cross,
  },
  osm_atm: {
    id: -7,
    label: 'Distributeurs (OSM)',
    valeurAPI: 'osm_atm',
    color: '#475569', // slate neutre service
    iconKey: 'banknote',
    svgPath: LUCIDE_PATHS.banknote,
  },
  osm_toilets: {
    id: -8,
    label: 'Toilettes (OSM)',
    valeurAPI: 'osm_toilets',
    color: '#A16207', // ambre brun, distinct des bleus eau et du jaune passage
    iconKey: 'toilet',
    svgPath: LUCIDE_PATHS.toilet,
  },
  pan_arret: {
    id: -9,
    label: 'Arrêts bus / cars',
    valeurAPI: 'pan_arret',
    color: '#EA580C', // orange-600, signalétique transport en commun
    iconKey: 'bus',
    svgPath: LUCIDE_PATHS.bus,
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
export const ANNEX_TYPE_KEYS: TypeKey[] = [
  'osm_water',
  'c2c_bivouac',
  'osm_shop',
  'sncf_gare',
  'dt_lodging',
  'osm_pharmacy',
  'osm_atm',
  'osm_toilets',
  'pan_arret',
];

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

// ─── Catégories de besoins utilisateur ─────────────────────────
// Le sélecteur affiche 5 catégories (Dormir/Boire/Ravito/Transport/Attention)
// au lieu de 10 sources individuelles. Chaque catégorie regroupe plusieurs
// TypeKey ; l'utilisateur peut activer une catégorie entière en un clic,
// ou expanser pour cocher source par source.

export type Category = 'dormir' | 'boire' | 'ravito' | 'transport' | 'attention';

export interface CategoryMeta {
  label: string;
  iconKey: TypeMeta['iconKey'];
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  dormir: { label: 'Dormir', iconKey: 'home' },
  boire: { label: 'Boire', iconKey: 'droplet' },
  ravito: { label: 'Service', iconKey: 'bag' },
  transport: { label: 'Transport', iconKey: 'train' },
  attention: { label: 'Attention', iconKey: 'alert' },
};

export const CATEGORY_ORDER: Category[] = [
  'dormir',
  'boire',
  'ravito',
  'transport',
  'attention',
];

/** Mapping catégorie → TypeKey qu'elle regroupe. La granularité Dormir est
 * ensuite affinée par les sous-groupes DATAtourisme (cf DT_GROUPS). */
export const CATEGORY_TO_TYPES: Record<Category, TypeKey[]> = {
  dormir: ['refuge', 'cabane', 'gite', 'c2c_bivouac', 'dt_lodging'],
  boire: ['pt_eau', 'osm_water'],
  ravito: ['osm_shop', 'osm_pharmacy', 'osm_atm', 'osm_toilets'],
  transport: ['sncf_gare', 'pan_arret'],
  attention: ['pt_passage'],
};

// ─── Sous-groupes DATAtourisme ─────────────────────────────────
// DATAtourisme expose une vingtaine d'URIs ontologiques pour les hébergements
// (Hotel, MountainHut, BedAndBreakfast, etc.). Pour l'UI on les regroupe en
// 9 catégories user-friendly. Le filtre côté MapView lit `enabledDtGroups`
// du store et ne garde que les features dont le sub appartient à un groupe
// activé.

export type DtGroup =
  | 'mountain_refuges'
  | 'gites'
  | 'bnb'
  | 'hostels'
  | 'camping'
  | 'hotels'
  | 'holiday_resort'
  | 'rental'
  | 'other';

export interface DtGroupMeta {
  label: string;
  subtypes: string[]; // URIs ontologiques DATAtourisme
}

export const DT_GROUPS: Record<DtGroup, DtGroupMeta> = {
  mountain_refuges: {
    label: 'Refuges privés',
    subtypes: ['MountainHut', 'MountainRefuge'],
  },
  gites: {
    label: "Gîtes d'étape",
    subtypes: ['Gite', 'GiteEtape', 'RuralAccommodation'],
  },
  bnb: {
    label: "Chambres d'hôtes",
    subtypes: ['BedAndBreakfast', 'GuestRoom'],
  },
  hostels: {
    label: 'Auberges',
    subtypes: ['Hostel', 'YouthHostel', 'CollectiveAccommodation'],
  },
  camping: {
    label: 'Campings',
    subtypes: ['Camping', 'CampingAndCaravanning'],
  },
  hotels: {
    label: 'Hôtels',
    subtypes: ['Hotel', 'HotelTrade', 'HotelRestaurant'],
  },
  holiday_resort: {
    label: 'Villages de vacances',
    subtypes: ['HolidayResort'],
  },
  rental: {
    label: 'Locations',
    subtypes: ['Rental'],
  },
  other: {
    label: 'Autres hébergements',
    subtypes: ['Accommodation', 'LodgingBusiness'],
  },
};

export const DT_GROUP_ORDER: DtGroup[] = [
  'mountain_refuges',
  'gites',
  'bnb',
  'hostels',
  'camping',
  'hotels',
  'holiday_resort',
  'rental',
  'other',
];

const DT_SUBTYPE_TO_GROUP: Record<string, DtGroup> = (() => {
  const map: Record<string, DtGroup> = {};
  for (const [group, meta] of Object.entries(DT_GROUPS)) {
    for (const sub of meta.subtypes) {
      map[sub] = group as DtGroup;
    }
  }
  return map;
})();

export function getDtGroupForSubtype(sub: string | undefined | null): DtGroup {
  if (!sub) return 'other';
  return DT_SUBTYPE_TO_GROUP[sub] ?? 'other';
}

/** Classification "Gratuit / Avec service" pour le sous-menu Dormir.
 * Cabanes non gardées et bivouacs Camptocamp = gratuits/autonomes ;
 * tout le reste demande nuit/cotisation/service. */
export const DORMIR_FREE_TYPES: TypeKey[] = ['cabane', 'c2c_bivouac'];
export const DORMIR_PAID_TYPES: TypeKey[] = ['refuge', 'gite'];
// dt_lodging est traité à part car il a son propre sous-menu par groupe DT.
