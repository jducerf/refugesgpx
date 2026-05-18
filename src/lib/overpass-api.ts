import { z } from 'zod';
import type { PoiFeature } from './types';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const NodeSchema = z.looseObject({
  type: z.literal('node'),
  id: z.number(),
  lat: z.number(),
  lon: z.number(),
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

function deriveSubtype(tags: Record<string, string>): string {
  if (tags.natural === 'spring') return 'source';
  if (tags.amenity === 'drinking_water') return 'eau potable';
  if (tags.man_made === 'water_tap') return 'robinet';
  if (tags.man_made === 'water_well') return 'puits';
  return 'eau';
}

const SESSION_CACHE_KEY = 'refuges-overpass-water';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const CACHE_MAX_ENTRIES = 10;

interface CacheEntry {
  ts: number;
  bbox: number[];
  features: PoiFeature[];
}

function readCache(bbox: Bbox): PoiFeature[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as CacheEntry[];
    const hit = arr.find(
      (e) =>
        Array.isArray(e.bbox) &&
        e.bbox.length === 4 &&
        e.bbox[0] === bbox[0] &&
        e.bbox[1] === bbox[1] &&
        e.bbox[2] === bbox[2] &&
        e.bbox[3] === bbox[3],
    );
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.features;
    return null;
  } catch {
    return null;
  }
}

function writeCache(bbox: Bbox, features: PoiFeature[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    const arr: CacheEntry[] = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
    const next = [{ ts: Date.now(), bbox: [...bbox], features }, ...arr.slice(0, CACHE_MAX_ENTRIES - 1)];
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota dépassé : noop */
  }
}

/**
 * Récupère les points d'eau (sources, eau potable, robinets, puits) OSM
 * dans une bbox via l'API Overpass. Utilise les IDs négatifs (= -osmId) pour
 * éviter toute collision avec les identifiants refuges.info (positifs).
 */
export async function fetchWaterPointsOSM(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<PoiFeature[]> {
  const cached = readCache(bbox);
  if (cached) return cached;

  // Overpass attend "south,west,north,east"
  const [w, s, e, n] = bbox;
  const overpassBbox = `${s},${w},${n},${e}`;

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
    const subtype = deriveSubtype(tags);
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

  writeCache(bbox, features);
  return features;
}
