import { z } from 'zod';
import type { PoiFeature } from './types';
import { bboxToGridKey, readCache, writeCache, TTL } from './cache';
import { osmSubtitle } from './osm-i18n';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE_PREFIX_WATER = 'osm-water';
const CACHE_PREFIX_SHOP = 'osm-shop';
const CACHE_PREFIX_AMENITY = 'osm-amenity';

// Décalage appliqué aux ways OSM pour qu'ils ne collisionnent jamais avec les
// nodes (négatif aussi) ni avec refuges.info (positifs) ni c2c (positifs avec
// offset 1e12).
const OSM_WAY_OFFSET = 1e10;

const NodeSchema = z.looseObject({
  type: z.literal('node'),
  id: z.number(),
  lat: z.number(),
  lon: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
});

const WayWithCenterSchema = z.looseObject({
  type: z.literal('way'),
  id: z.number(),
  center: z.object({ lat: z.number(), lon: z.number() }),
  tags: z.record(z.string(), z.string()).optional(),
});

const OverpassResponseSchema = z.looseObject({
  elements: z.array(z.looseObject({ type: z.string() })),
});

export type Bbox = [number, number, number, number]; // [west, south, east, north]

function deriveName(tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  if (tags.natural === 'spring') return 'Source';
  if (tags.amenity === 'drinking_water') return 'Eau potable';
  if (tags.man_made === 'water_tap') return 'Robinet';
  if (tags.man_made === 'water_well') return 'Puits';
  return "Point d'eau (OSM)";
}

// Le sous-titre FR est dérivé via osmSubtitle() (lib/osm-i18n) pour rester
// cohérent avec l'affichage du dialog et des futures sources OSM.

/**
 * Récupère les points d'eau (sources, eau potable, robinets, puits) OSM
 * dans une bbox via l'API Overpass. Identifiants négatifs (= -osmId) pour
 * éviter toute collision avec refuges.info (positifs) et c2c (offset 1e12).
 * Cache IndexedDB par bbox grid 0,02° (TTL 24 h).
 */
export async function fetchWaterPointsOSM(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<PoiFeature[]> {
  const cacheKey = bboxToGridKey(bbox);
  const cached = await readCache<PoiFeature[]>(CACHE_PREFIX_WATER, cacheKey, TTL.BBOX);
  if (cached) return cached;

  // Overpass attend "south,west,north,east"
  // On élargit légèrement la requête pour matcher la bbox grid arrondie
  const [gw, gs, ge, gn] = cacheKey.split(',').map(Number) as Bbox;
  const overpassBbox = `${gs},${gw},${gn},${ge}`;

  const query = `[out:json][timeout:25];
(
  node["natural"="spring"](${overpassBbox});
  node["amenity"="drinking_water"](${overpassBbox});
  node["man_made"="water_tap"](${overpassBbox});
  node["man_made"="water_well"](${overpassBbox});
);
out body;`;

  const r = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });
  if (!r.ok) throw new Error(`Overpass API → ${r.status}`);

  const json = await r.json();
  const parsed = OverpassResponseSchema.parse(json);

  const features: PoiFeature[] = [];
  for (const el of parsed.elements) {
    const safe = NodeSchema.safeParse(el);
    if (!safe.success) continue;
    const node = safe.data;
    const tags = (node.tags ?? {}) as Record<string, string>;
    const nom = deriveName(tags);
    const subtype = osmSubtitle(tags);
    const eleNum = tags.ele !== undefined ? parseFloat(tags.ele) : NaN;
    const alt = Number.isFinite(eleNum) ? Math.round(eleNum) : undefined;
    const negId = -node.id;
    features.push({
      type: 'Feature',
      id: negId,
      geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
      properties: {
        id: negId,
        nom,
        type: { id: -1, valeur: 'osm_water' },
        coord: alt !== undefined ? { alt } : undefined,
        lien: `https://www.openstreetmap.org/node/${node.id}`,
        osmTags: tags,
        osmSubtype: subtype,
        osmId: node.id,
      },
    } as unknown as PoiFeature);
  }

  await writeCache(CACHE_PREFIX_WATER, cacheKey, features);
  return features;
}

// ─── Commerces / ravitaillement OSM ────────────────────────────────────

const SHOP_VALUES = [
  'supermarket',
  'convenience',
  'grocery',
  'bakery',
  'butcher',
  'greengrocer',
  'cheese',
  'deli',
  'pastry',
  'farm',
  'general',
  'health_food',
] as const;

function deriveShopName(tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  const sub = osmSubtitle(tags);
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

/**
 * Récupère les commerces de ravitaillement OSM (supermarchés, épiceries,
 * boulangeries, boucheries, marchés…) dans une bbox via Overpass.
 *
 * Contrairement aux points d'eau (toujours mappés en nodes), les commerces
 * sont fréquemment des ways (footprints de bâtiments). On demande donc
 * `out tags center` et on prend le centroïde pour avoir un point exploitable.
 * Les ways prennent un offset d'ID pour éviter toute collision avec les nodes.
 */
export async function fetchShopsOSM(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<PoiFeature[]> {
  const cacheKey = bboxToGridKey(bbox);
  const cached = await readCache<PoiFeature[]>(CACHE_PREFIX_SHOP, cacheKey, TTL.BBOX);
  if (cached) return cached;

  const [gw, gs, ge, gn] = cacheKey.split(',').map(Number) as Bbox;
  const overpassBbox = `${gs},${gw},${gn},${ge}`;
  const shopFilter = SHOP_VALUES.join('|');

  const query = `[out:json][timeout:25];
(
  node["shop"~"^(${shopFilter})$"](${overpassBbox});
  way["shop"~"^(${shopFilter})$"](${overpassBbox});
  node["amenity"="marketplace"](${overpassBbox});
  way["amenity"="marketplace"](${overpassBbox});
);
out tags center;`;

  const r = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });
  if (!r.ok) throw new Error(`Overpass API → ${r.status}`);

  const json = await r.json();
  const parsed = OverpassResponseSchema.parse(json);

  const features: PoiFeature[] = [];
  for (const el of parsed.elements) {
    let osmId: number;
    let osmType: 'node' | 'way';
    let lat: number;
    let lon: number;
    let tags: Record<string, string>;

    if (el.type === 'node') {
      const safe = NodeSchema.safeParse(el);
      if (!safe.success) continue;
      osmId = safe.data.id;
      osmType = 'node';
      lat = safe.data.lat;
      lon = safe.data.lon;
      tags = (safe.data.tags ?? {}) as Record<string, string>;
    } else if (el.type === 'way') {
      const safe = WayWithCenterSchema.safeParse(el);
      if (!safe.success) continue;
      osmId = safe.data.id;
      osmType = 'way';
      lat = safe.data.center.lat;
      lon = safe.data.center.lon;
      tags = (safe.data.tags ?? {}) as Record<string, string>;
    } else {
      continue;
    }

    const localId = osmType === 'way' ? -(osmId + OSM_WAY_OFFSET) : -osmId;
    const nom = deriveShopName(tags);
    const subtype = osmSubtitle(tags);

    features.push({
      type: 'Feature',
      id: localId,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id: localId,
        nom,
        type: { id: -3, valeur: 'osm_shop' },
        lien: `https://www.openstreetmap.org/${osmType}/${osmId}`,
        osmTags: tags,
        osmSubtype: subtype,
        osmId,
        osmType,
      },
    } as unknown as PoiFeature);
  }

  await writeCache(CACHE_PREFIX_SHOP, cacheKey, features);
  return features;
}

// ─── Amenities OSM (pharmacy / atm / toilets) ──────────────────────────

/** Tag amenity OSM → TypeKey applicatif. */
const AMENITY_TO_TYPE: Record<string, { valeur: string; typeId: number; nomFallback: string }> = {
  pharmacy: { valeur: 'osm_pharmacy', typeId: -6, nomFallback: 'Pharmacie' },
  atm: { valeur: 'osm_atm', typeId: -7, nomFallback: 'Distributeur' },
  toilets: { valeur: 'osm_toilets', typeId: -8, nomFallback: 'Toilettes' },
};

/**
 * Récupère pharmacies, distributeurs et toilettes publiques OSM dans une
 * bbox via Overpass. Tout est groupé en une seule requête pour économiser
 * un aller-retour par catégorie (Overpass facture surtout le round-trip).
 *
 * Le filtre par sous-catégorie (l'utilisateur peut n'activer que pharmacies
 * sans ATM) se fait ensuite côté MapView via `enabledAnnexTypes`.
 *
 * Comme pour les commerces, ces amenities sont souvent des ways (footprints
 * de bâtiments), d'où `out tags center` et l'offset d'ID pour ways.
 */
export async function fetchAmenitiesOSM(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<PoiFeature[]> {
  const cacheKey = bboxToGridKey(bbox);
  const cached = await readCache<PoiFeature[]>(CACHE_PREFIX_AMENITY, cacheKey, TTL.BBOX);
  if (cached) return cached;

  const [gw, gs, ge, gn] = cacheKey.split(',').map(Number) as Bbox;
  const overpassBbox = `${gs},${gw},${gn},${ge}`;
  const amenityFilter = Object.keys(AMENITY_TO_TYPE).join('|');

  const query = `[out:json][timeout:25];
(
  node["amenity"~"^(${amenityFilter})$"](${overpassBbox});
  way["amenity"~"^(${amenityFilter})$"](${overpassBbox});
);
out tags center;`;

  const r = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
    signal,
  });
  if (!r.ok) throw new Error(`Overpass API → ${r.status}`);

  const json = await r.json();
  const parsed = OverpassResponseSchema.parse(json);

  const features: PoiFeature[] = [];
  for (const el of parsed.elements) {
    let osmId: number;
    let osmType: 'node' | 'way';
    let lat: number;
    let lon: number;
    let tags: Record<string, string>;

    if (el.type === 'node') {
      const safe = NodeSchema.safeParse(el);
      if (!safe.success) continue;
      osmId = safe.data.id;
      osmType = 'node';
      lat = safe.data.lat;
      lon = safe.data.lon;
      tags = (safe.data.tags ?? {}) as Record<string, string>;
    } else if (el.type === 'way') {
      const safe = WayWithCenterSchema.safeParse(el);
      if (!safe.success) continue;
      osmId = safe.data.id;
      osmType = 'way';
      lat = safe.data.center.lat;
      lon = safe.data.center.lon;
      tags = (safe.data.tags ?? {}) as Record<string, string>;
    } else {
      continue;
    }

    const amenity = tags.amenity;
    const meta = amenity ? AMENITY_TO_TYPE[amenity] : undefined;
    if (!meta) continue;

    const localId = osmType === 'way' ? -(osmId + OSM_WAY_OFFSET) : -osmId;
    const nom = tags.name ?? meta.nomFallback;
    const subtype = osmSubtitle(tags);

    features.push({
      type: 'Feature',
      id: localId,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id: localId,
        nom,
        type: { id: meta.typeId, valeur: meta.valeur },
        lien: `https://www.openstreetmap.org/${osmType}/${osmId}`,
        osmTags: tags,
        osmSubtype: subtype,
        osmId,
        osmType,
      },
    } as unknown as PoiFeature);
  }

  await writeCache(CACHE_PREFIX_AMENITY, cacheKey, features);
  return features;
}
