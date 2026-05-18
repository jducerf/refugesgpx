/**
 * Traductions et formatage humain des tags OSM pour affichage utilisateur.
 *
 * OSM expose des tags en snake_case anglais (`drinking_water`, `water_tap`,
 * `wheelchair=limited`…). Ce module les rend lisibles en français.
 *
 * `labelKey()` / `labelValue()` retombent sur une transformation générique
 * (snake_case → "snake case" capitalisé) plutôt que d'afficher la valeur brute,
 * ce qui évite les régressions visuelles quand OSM ajoute un nouveau tag.
 */

/** Étiquette FR pour une clé OSM. */
const KEY_LABELS: Record<string, string> = {
  natural: 'Type',
  amenity: 'Type',
  man_made: 'Ouvrage',
  shop: 'Commerce',
  description: 'Description',
  operator: 'Gestionnaire',
  ele: 'Altitude',
  intermittent: 'Intermittent',
  seasonal: 'Saisonnier',
  source: 'Source de la donnée',
  'name:fr': 'Nom (FR)',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipédia',
  fee: 'Payant',
  access: 'Accès',
  drinking_water: 'Potable',
  pump: 'Pompe',
  wheelchair: 'Accessible PMR',
  bottle: 'Remplissage bouteille',
  covered: 'Couvert',
  indoor: 'Intérieur',
  opening_hours: "Horaires",
  website: 'Site web',
  phone: 'Téléphone',
  email: 'Email',
  addr_full: 'Adresse',
};

/** Étiquette FR pour une valeur, indexée par clé OSM. */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  natural: {
    spring: 'source',
    water: 'plan d’eau',
  },
  amenity: {
    drinking_water: 'eau potable',
    fountain: 'fontaine',
    water_point: "point d'eau",
    shower: 'douche',
    toilets: 'toilettes',
    shelter: 'abri',
  },
  man_made: {
    water_tap: 'robinet',
    water_well: 'puits',
    water_tower: "château d'eau",
    spring_box: 'captage',
    cistern: 'citerne',
  },
  pump: {
    manual: 'manuelle',
    powered: 'motorisée',
    no: 'non',
    yes: 'oui',
  },
  wheelchair: {
    yes: 'oui',
    no: 'non',
    limited: 'partiel',
  },
  drinking_water: {
    yes: 'oui',
    no: 'non',
    treated: 'traitée',
    conditional: 'conditionnel',
  },
  access: {
    yes: 'libre',
    no: 'interdit',
    private: 'privé',
    permissive: 'toléré',
    customers: 'clients',
    permit: 'sur autorisation',
  },
  bottle: {
    yes: 'oui',
    no: 'non',
  },
  seasonal: {
    yes: 'oui',
    no: 'non',
    spring: 'printemps',
    summer: 'été',
    autumn: 'automne',
    winter: 'hiver',
  },
  intermittent: {
    yes: 'oui',
    no: 'non',
  },
  fee: {
    yes: 'oui',
    no: 'non',
  },
  covered: {
    yes: 'oui',
    no: 'non',
  },
};

/** Valeurs génériques traduites, fallback si pas d'entrée dans VALUE_LABELS. */
const GENERIC_VALUES: Record<string, string> = {
  yes: 'oui',
  no: 'non',
  unknown: 'inconnu',
};

/** snake_case → "Snake case" (fallback humain pour clés inconnues). */
function humanize(raw: string): string {
  const spaced = raw.replace(/_/g, ' ').replace(/:/g, ' · ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Étiquette FR pour une clé OSM (avec fallback humain). */
export function labelKey(key: string): string {
  return KEY_LABELS[key] ?? humanize(key);
}

/** Étiquette FR pour la valeur d'un tag OSM (avec fallback humain). */
export function labelValue(key: string, value: string): string {
  if (key === 'ele') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return `${Math.round(n)} m`;
  }
  const perKey = VALUE_LABELS[key]?.[value];
  if (perKey) return perKey;
  const generic = GENERIC_VALUES[value];
  if (generic) return generic;
  // Si la valeur ressemble à un identifiant OSM brut, on l'humanise.
  if (/^[a-z0-9_]+$/.test(value)) return humanize(value);
  return value;
}

/**
 * Sous-titre court pour un point OSM, dérivé d'abord des tags structurants
 * (natural / amenity / man_made / shop) puis fallback "point OSM".
 */
export function osmSubtitle(tags: Record<string, string>): string {
  if (tags.natural && VALUE_LABELS.natural?.[tags.natural]) return VALUE_LABELS.natural[tags.natural]!;
  if (tags.amenity && VALUE_LABELS.amenity?.[tags.amenity]) return VALUE_LABELS.amenity[tags.amenity]!;
  if (tags.man_made && VALUE_LABELS.man_made?.[tags.man_made]) return VALUE_LABELS.man_made[tags.man_made]!;
  if (tags.shop) return labelValue('shop', tags.shop);
  return 'point OSM';
}
