import { z } from 'zod';
import type { ParsedGpx } from './types';
import { readCache, writeCache } from './cache';

/**
 * Vigilance Météo-France — côté client.
 *
 * Deux niveaux :
 *  1. `fetchVigilance()` appelle notre proxy Netlify (`/.netlify/functions/vigilance`)
 *     qui détient la clé. Retourne la "carte" en cours pour toute la France.
 *  2. `traceDepartements()` détermine quels départements la trace traverse via
 *     l'API geo.api.gouv.fr (CORS, sans clé). On échantillonne quelques points
 *     équirépartis sur la trace pour ne pas spammer.
 *
 * On laisse l'appelant croiser les deux : `byDept[code]` donne le niveau max
 * et le détail par phénomène pour chaque département concerné.
 */

const VIGILANCE_URL = '/.netlify/functions/vigilance';
const COMMUNES_URL = 'https://geo.api.gouv.fr/communes';

const COMMUNE_CACHE_PREFIX = 'vigilance-dept';
const COMMUNE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 j (un point GPS change rarement de dept)

// ─── Schéma Zod (extrait minimal des champs qu'on utilise) ─────────────

const PhenomenonItemSchema = z.looseObject({
  phenomenon_id: z.string(),
  phenomenon_max_color_id: z.number(),
});

const DomainItemSchema = z.looseObject({
  domain_id: z.string(), // code département ("75", "2A", "974"…)
  max_color_id: z.number().optional(),
  phenomenon_items: z.array(PhenomenonItemSchema).default([]),
});

const PeriodSchema = z.looseObject({
  echeance: z.string(), // "J" ou "J1"
  begin_validity_time: z.string().optional(),
  end_validity_time: z.string().optional(),
  // Les départements sont nichés dans `timelaps.domain_ids` (vérifié sur la
  // réponse réelle de l'API en mai 2026 — la doc Swagger est imprécise sur ce
  // point).
  timelaps: z
    .looseObject({
      domain_ids: z.array(DomainItemSchema).default([]),
    })
    .optional(),
});

const VigilanceResponseSchema = z.looseObject({
  product: z.looseObject({
    update_time: z.string().optional(),
    global_max_color_id: z.union([z.string(), z.number()]).optional(),
    periods: z.array(PeriodSchema).default([]),
  }),
});

export type VigilanceRaw = z.infer<typeof VigilanceResponseSchema>;

// ─── Métadonnées phénomènes / couleurs ─────────────────────────────────

export const COLOR_LABELS: Record<number, { label: string; cssVar: string; hex: string }> = {
  1: { label: 'Vert', cssVar: '--vigilance-green', hex: '#31C754' },
  2: { label: 'Jaune', cssVar: '--vigilance-yellow', hex: '#FFD800' },
  3: { label: 'Orange', cssVar: '--vigilance-orange', hex: '#FF9100' },
  4: { label: 'Rouge', cssVar: '--vigilance-red', hex: '#E53935' },
};

export const PHENOMENON_LABELS: Record<string, string> = {
  '1': 'Vent violent',
  '2': 'Pluie-inondation',
  '3': 'Orages',
  '4': 'Crues',
  '5': 'Neige-verglas',
  '6': 'Canicule',
  '7': 'Grand-froid',
  '8': 'Avalanches',
  '9': 'Vagues-submersion',
};

// Phénomènes pertinents pour la rando montagne — affichés en priorité.
// Crues = cours d'eau (déclencheur SCHAPI), pas montagne.
export const HIKING_PHENOMENA = new Set(['1', '2', '3', '5', '6', '8']);

// ─── Vigilance ─────────────────────────────────────────────────────────

export interface DeptVigilance {
  deptCode: string;
  maxColor: number;
  phenomena: Array<{ id: string; label: string; color: number }>;
}

export type Echeance = 'J' | 'J1';

export interface VigilancePeriod {
  echeance: Echeance;
  beginTime?: string;
  endTime?: string;
  byDept: Map<string, DeptVigilance>;
}

export interface VigilanceSnapshot {
  updateTime?: string;
  periods: VigilancePeriod[]; // [J, J1] — Météo-France ne va pas plus loin que J+1
}

function extractPeriod(
  raw: z.infer<typeof PeriodSchema> | undefined,
): VigilancePeriod | null {
  if (!raw) return null;
  const byDept = new Map<string, DeptVigilance>();
  const domains = raw.timelaps?.domain_ids ?? [];
  for (const d of domains) {
    // Le payload mélange codes département (ex. "75", "2A") et codes zones
    // côtières à 4 chiffres (ex. "1310" pour la côte de l'Aude) : on ne
    // garde que les codes département classiques.
    if (!/^(\d{2,3}|2A|2B)$/.test(d.domain_id)) continue;
    byDept.set(d.domain_id, {
      deptCode: d.domain_id,
      maxColor: d.max_color_id ?? 1,
      phenomena: d.phenomenon_items
        .map((p) => ({
          id: p.phenomenon_id,
          label: PHENOMENON_LABELS[p.phenomenon_id] ?? `Phénomène ${p.phenomenon_id}`,
          color: p.phenomenon_max_color_id,
        }))
        // Trie par couleur décroissante puis par label
        .sort((a, b) => b.color - a.color || a.label.localeCompare(b.label)),
    });
  }
  return {
    echeance: raw.echeance as Echeance,
    beginTime: raw.begin_validity_time,
    endTime: raw.end_validity_time,
    byDept,
  };
}

export async function fetchVigilance(signal?: AbortSignal): Promise<VigilanceSnapshot> {
  const r = await fetch(VIGILANCE_URL, { signal });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail?.error || `Vigilance API → ${r.status}`);
  }
  const raw = await r.json();
  const parsed = VigilanceResponseSchema.parse(raw);

  const periods: VigilancePeriod[] = [];
  for (const e of ['J', 'J1'] as const) {
    const period = extractPeriod(parsed.product.periods.find((p) => p.echeance === e));
    if (period) periods.push(period);
  }

  return {
    updateTime: parsed.product.update_time,
    periods,
  };
}

// ─── Départements traversés par la trace ───────────────────────────────

const CommuneSchema = z.looseObject({
  codeDepartement: z.string().optional(),
  nom: z.string().optional(),
});

/** Échantillonne ~8 points équirépartis le long de la trace. Suffisant pour
 * couvrir un parcours qui traverse plusieurs départements (ils font 60-80 km
 * de large en moyenne) tout en restant raisonnable côté volume d'appels. */
function sampleTracePoints(trace: ParsedGpx, samples = 8): Array<[number, number]> {
  const pts = trace.points;
  if (pts.length === 0) return [];
  if (pts.length <= samples) return pts.map((p) => [p.lon, p.lat]);
  const step = Math.floor(pts.length / samples);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < samples; i++) {
    const p = pts[Math.min(i * step, pts.length - 1)];
    if (p) out.push([p.lon, p.lat]);
  }
  // Ajoute le tout dernier point pour couvrir une fin éventuellement dans un
  // autre département.
  const last = pts[pts.length - 1];
  if (last) out.push([last.lon, last.lat]);
  return out;
}

async function deptFromLatLon(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<string | null> {
  // Arrondi à ~100m pour grouper les requêtes voisines dans le cache.
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  const cached = await readCache<string>(COMMUNE_CACHE_PREFIX, key, COMMUNE_CACHE_TTL);
  if (cached) return cached;

  const url = new URL(COMMUNES_URL);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('fields', 'codeDepartement');
  url.searchParams.set('format', 'json');
  url.searchParams.set('geometry', 'centre');

  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return null;
    const raw = (await r.json()) as unknown;
    const arr = Array.isArray(raw) ? raw : [];
    const first = arr[0];
    const parsed = CommuneSchema.safeParse(first);
    const code = parsed.success ? (parsed.data.codeDepartement ?? null) : null;
    if (code) await writeCache(COMMUNE_CACHE_PREFIX, key, code);
    return code;
  } catch {
    return null;
  }
}

export async function traceDepartements(
  trace: ParsedGpx,
  signal?: AbortSignal,
): Promise<string[]> {
  const samples = sampleTracePoints(trace);
  const results = await Promise.all(
    samples.map(([lon, lat]) => deptFromLatLon(lon, lat, signal)),
  );
  const seen = new Set<string>();
  for (const code of results) {
    if (code) seen.add(code);
  }
  return Array.from(seen).sort();
}
