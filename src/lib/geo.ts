import * as turf from '@turf/turf';
import type { Feature, LineString, Polygon } from 'geojson';
import type {
  BufferPolygonFeature,
  ParsedGpx,
  PoiCandidate,
  PoiFeature,
  PoiSource,
  TraceLineFeature,
} from './types';

export function traceToLine(trace: ParsedGpx): TraceLineFeature {
  const coords = trace.points.map((p) =>
    p.ele !== undefined ? [p.lon, p.lat, p.ele] : [p.lon, p.lat],
  );
  return turf.lineString(coords, { name: trace.name }) as TraceLineFeature;
}

export function traceBbox(trace: ParsedGpx): [number, number, number, number] {
  const line = traceToLine(trace);
  const bb = turf.bbox(line);
  return [bb[0], bb[1], bb[2], bb[3]];
}

export function expandBboxMeters(
  bbox: [number, number, number, number],
  meters: number,
): [number, number, number, number] {
  const padLat = meters / 111_320;
  const midLat = (bbox[1] + bbox[3]) / 2;
  const padLon = meters / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return [bbox[0] - padLon, bbox[1] - padLat, bbox[2] + padLon, bbox[3] + padLat];
}

export function bufferLine(
  line: TraceLineFeature,
  meters: number,
): BufferPolygonFeature {
  const buf = turf.buffer(line, meters, { units: 'meters' }) as
    | Feature<Polygon>
    | undefined;
  if (!buf) throw new Error('Buffer impossible (trace trop courte ?)');
  return buf as BufferPolygonFeature;
}

export function getPoiId(f: PoiFeature): number | undefined {
  const propId = f.properties.id;
  if (typeof propId === 'number') return propId;
  if (typeof f.id === 'number') return f.id;
  if (typeof f.id === 'string' && /^\d+$/.test(f.id)) return parseInt(f.id, 10);
  return undefined;
}

export function filterByDistance(
  line: TraceLineFeature,
  pois: PoiFeature[],
  maxMeters: number,
  source: PoiSource = 'refuges',
): PoiCandidate[] {
  const list: PoiCandidate[] = [];
  for (const f of pois) {
    const id = getPoiId(f);
    if (id === undefined) continue;
    const nearest = turf.nearestPointOnLine(line as Feature<LineString>, f);
    const distKm = nearest.properties.dist as number;
    const distM = distKm * 1000;
    if (distM <= maxMeters) list.push({ feature: f, distM, id, source });
  }
  list.sort((a, b) => a.distM - b.distM);
  return list;
}

export function traceLengthKm(trace: ParsedGpx): number {
  const line = traceToLine(trace);
  return turf.length(line, { units: 'kilometers' });
}

export function traceElevationStats(trace: ParsedGpx): {
  ascent: number;
  descent: number;
  min: number;
  max: number;
} {
  let ascent = 0;
  let descent = 0;
  let min = Infinity;
  let max = -Infinity;
  let prev: number | undefined;
  for (const p of trace.points) {
    if (p.ele === undefined) continue;
    if (p.ele < min) min = p.ele;
    if (p.ele > max) max = p.ele;
    if (prev !== undefined) {
      const d = p.ele - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
    prev = p.ele;
  }
  if (min === Infinity) return { ascent: 0, descent: 0, min: 0, max: 0 };
  return { ascent: Math.round(ascent), descent: Math.round(descent), min: Math.round(min), max: Math.round(max) };
}
