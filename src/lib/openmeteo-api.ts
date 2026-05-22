import { z } from 'zod';
import { readCache, writeCache } from './cache';

/**
 * Open-Meteo — API gratuite, sans clé, CORS ouvert.
 * Documentation : https://open-meteo.com/en/docs
 *
 * On l'utilise pour ce que la Vigilance Météo-France ne couvre pas :
 *   - prévisions au-delà de J+1 (jusqu'à 7 jours),
 *   - détail horaire du jour J,
 *   - indices dérivés rando : UV, isotherme 0°C, rafales,
 *   - météo spécifique au point GPS d'un POI (altitude variable).
 *
 * Côté licence : Open-Meteo agrège des modèles publics (ICON-EU, AROME,
 * GFS…) et redistribue les résultats sous CC-BY 4.0. L'attribution est
 * affichée dans l'UI à côté de celle de Météo-France.
 */

const API_URL = 'https://api.open-meteo.com/v1/forecast';

const CACHE_PREFIX = 'openmeteo';
const CACHE_TTL = 60 * 60 * 1000; // 1h — Open-Meteo rafraîchit ~toutes les heures

// ─── Variables Open-Meteo qu'on demande ──────────────────────────────────

const DAILY_VARS = [
  'weathercode',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'windspeed_10m_max',
  'windgusts_10m_max',
  'uv_index_max',
  'snowfall_sum',
  'sunrise',
  'sunset',
] as const;

const HOURLY_VARS = [
  'weathercode',
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'windspeed_10m',
  'freezing_level_height',
] as const;

const CURRENT_VARS = [
  'weathercode',
  'temperature_2m',
  'windspeed_10m',
  'precipitation',
] as const;

// ─── Schéma Zod ──────────────────────────────────────────────────────────

const DailySchema = z.looseObject({
  time: z.array(z.string()),
  weathercode: z.array(z.number().nullable()),
  temperature_2m_max: z.array(z.number().nullable()),
  temperature_2m_min: z.array(z.number().nullable()),
  precipitation_sum: z.array(z.number().nullable()),
  precipitation_probability_max: z.array(z.number().nullable()).optional(),
  windspeed_10m_max: z.array(z.number().nullable()),
  windgusts_10m_max: z.array(z.number().nullable()).optional(),
  uv_index_max: z.array(z.number().nullable()).optional(),
  snowfall_sum: z.array(z.number().nullable()).optional(),
  sunrise: z.array(z.string()).optional(),
  sunset: z.array(z.string()).optional(),
});

const HourlySchema = z.looseObject({
  time: z.array(z.string()),
  weathercode: z.array(z.number().nullable()),
  temperature_2m: z.array(z.number().nullable()),
  precipitation: z.array(z.number().nullable()),
  precipitation_probability: z.array(z.number().nullable()).optional(),
  windspeed_10m: z.array(z.number().nullable()),
  freezing_level_height: z.array(z.number().nullable()).optional(),
});

const CurrentSchema = z.looseObject({
  time: z.string(),
  weathercode: z.number().nullable(),
  temperature_2m: z.number().nullable(),
  windspeed_10m: z.number().nullable(),
  precipitation: z.number().nullable().optional(),
});

const ForecastSchema = z.looseObject({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  timezone: z.string().optional(),
  current: CurrentSchema.optional(),
  daily: DailySchema.optional(),
  hourly: HourlySchema.optional(),
});

export type ForecastRaw = z.infer<typeof ForecastSchema>;

// ─── Types publics simplifiés ────────────────────────────────────────────

export interface DailyForecast {
  date: string; // ISO YYYY-MM-DD
  weathercode: number;
  tMin: number;
  tMax: number;
  precipMm: number;
  precipProbPct: number | null;
  windMaxKmh: number;
  gustMaxKmh: number | null;
  uvMax: number | null;
  snowfallCm: number | null;
}

export interface HourlyPoint {
  time: string; // ISO datetime
  weathercode: number;
  temp: number;
  precipMm: number;
  precipProbPct: number | null;
  windKmh: number;
  freezingLevelM: number | null;
}

export interface CurrentWeather {
  time: string;
  weathercode: number;
  temp: number;
  windKmh: number;
}

export interface PointForecast {
  latitude: number;
  longitude: number;
  elevation: number | null;
  current: CurrentWeather | null;
  daily: DailyForecast[];
  hourly: HourlyPoint[];
}

// ─── Fetch principal ─────────────────────────────────────────────────────

export interface FetchForecastOpts {
  /** Inclure le bloc daily (7 jours) — true par défaut. */
  daily?: boolean;
  /** Inclure le bloc hourly (24h du jour) — true par défaut. */
  hourly?: boolean;
  /** Inclure le bloc current — true par défaut. */
  current?: boolean;
  /** Nombre de jours de prévision — 7 par défaut (max gratuit = 16). */
  forecastDays?: number;
}

/**
 * Récupère la prévision pour 1..N points GPS. Open-Meteo accepte les
 * coordonnées en liste séparée par virgules et renvoie un tableau ; pour 1
 * seul point il renvoie un objet — on normalise toujours en tableau.
 */
export async function fetchForecast(
  coords: Array<[number, number]>, // [[lon, lat], ...]
  opts: FetchForecastOpts = {},
  signal?: AbortSignal,
): Promise<PointForecast[]> {
  if (coords.length === 0) return [];
  const {
    daily = true,
    hourly = true,
    current = true,
    forecastDays = 7,
  } = opts;

  // Clé de cache : on arrondit les coords à ~100m pour grouper les points
  // voisins. Inclut les options pour éviter qu'un cache "daily only" serve
  // une requête qui veut aussi du hourly.
  const cacheKey = JSON.stringify({
    coords: coords.map(([lon, lat]) => [lon.toFixed(3), lat.toFixed(3)]),
    daily,
    hourly,
    current,
    forecastDays,
  });
  const cached = await readCache<PointForecast[]>(CACHE_PREFIX, cacheKey, CACHE_TTL);
  if (cached) return cached;

  const url = new URL(API_URL);
  url.searchParams.set(
    'latitude',
    coords.map(([, lat]) => lat.toFixed(4)).join(','),
  );
  url.searchParams.set(
    'longitude',
    coords.map(([lon]) => lon.toFixed(4)).join(','),
  );
  if (daily) url.searchParams.set('daily', DAILY_VARS.join(','));
  if (hourly) url.searchParams.set('hourly', HOURLY_VARS.join(','));
  if (current) url.searchParams.set('current', CURRENT_VARS.join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', String(forecastDays));
  url.searchParams.set('windspeed_unit', 'kmh');
  url.searchParams.set('precipitation_unit', 'mm');
  url.searchParams.set('temperature_unit', 'celsius');

  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Open-Meteo → ${r.status}`);
  const data = await r.json();
  // Open-Meteo renvoie un objet pour 1 point, un tableau pour N points.
  const rawArr: unknown[] = Array.isArray(data) ? data : [data];
  const out: PointForecast[] = [];
  for (const raw of rawArr) {
    const parsed = ForecastSchema.parse(raw);
    out.push(toPointForecast(parsed));
  }
  await writeCache(CACHE_PREFIX, cacheKey, out);
  return out;
}

function toPointForecast(raw: ForecastRaw): PointForecast {
  const daily: DailyForecast[] = [];
  if (raw.daily) {
    const d = raw.daily;
    for (let i = 0; i < d.time.length; i++) {
      const dateVal = d.time[i];
      if (!dateVal) continue;
      daily.push({
        date: dateVal,
        weathercode: d.weathercode[i] ?? 0,
        tMin: d.temperature_2m_min[i] ?? 0,
        tMax: d.temperature_2m_max[i] ?? 0,
        precipMm: d.precipitation_sum[i] ?? 0,
        precipProbPct: d.precipitation_probability_max?.[i] ?? null,
        windMaxKmh: d.windspeed_10m_max[i] ?? 0,
        gustMaxKmh: d.windgusts_10m_max?.[i] ?? null,
        uvMax: d.uv_index_max?.[i] ?? null,
        snowfallCm: d.snowfall_sum?.[i] ?? null,
      });
    }
  }

  const hourly: HourlyPoint[] = [];
  if (raw.hourly) {
    const h = raw.hourly;
    for (let i = 0; i < h.time.length; i++) {
      const time = h.time[i];
      if (!time) continue;
      hourly.push({
        time,
        weathercode: h.weathercode[i] ?? 0,
        temp: h.temperature_2m[i] ?? 0,
        precipMm: h.precipitation[i] ?? 0,
        precipProbPct: h.precipitation_probability?.[i] ?? null,
        windKmh: h.windspeed_10m[i] ?? 0,
        freezingLevelM: h.freezing_level_height?.[i] ?? null,
      });
    }
  }

  const current: CurrentWeather | null = raw.current
    ? {
        time: raw.current.time,
        weathercode: raw.current.weathercode ?? 0,
        temp: raw.current.temperature_2m ?? 0,
        windKmh: raw.current.windspeed_10m ?? 0,
      }
    : null;

  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    elevation: raw.elevation ?? null,
    current,
    daily,
    hourly,
  };
}

// ─── Helpers : weathercode → libellé/icône ───────────────────────────────

export type WeatherIconKey =
  | 'sun'
  | 'cloud-sun'
  | 'cloud'
  | 'cloud-drizzle'
  | 'cloud-rain'
  | 'cloud-rain-heavy'
  | 'cloud-snow'
  | 'cloud-lightning'
  | 'cloud-fog';

export interface WeatherMeta {
  label: string;
  icon: WeatherIconKey;
}

/**
 * Mapping WMO weathercode → libellé français + icône.
 * https://open-meteo.com/en/docs#weathervariables
 */
export function weatherMeta(code: number): WeatherMeta {
  if (code === 0) return { label: 'Ciel clair', icon: 'sun' };
  if (code === 1) return { label: 'Peu nuageux', icon: 'cloud-sun' };
  if (code === 2) return { label: 'Partiellement nuageux', icon: 'cloud-sun' };
  if (code === 3) return { label: 'Couvert', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'cloud-fog' };
  if (code >= 51 && code <= 57) return { label: 'Bruine', icon: 'cloud-drizzle' };
  if (code === 61 || code === 80) return { label: 'Pluie faible', icon: 'cloud-rain' };
  if (code === 63 || code === 81) return { label: 'Pluie modérée', icon: 'cloud-rain' };
  if (code === 65 || code === 82) return { label: 'Pluie forte', icon: 'cloud-rain-heavy' };
  if (code === 66 || code === 67) return { label: 'Pluie verglaçante', icon: 'cloud-rain' };
  if (code === 71 || code === 85) return { label: 'Neige faible', icon: 'cloud-snow' };
  if (code === 73) return { label: 'Neige modérée', icon: 'cloud-snow' };
  if (code === 75 || code === 86) return { label: 'Neige forte', icon: 'cloud-snow' };
  if (code === 77) return { label: 'Grains de neige', icon: 'cloud-snow' };
  if (code === 95) return { label: 'Orage', icon: 'cloud-lightning' };
  if (code === 96 || code === 99) return { label: 'Orage avec grêle', icon: 'cloud-lightning' };
  return { label: 'Inconnu', icon: 'cloud' };
}

/**
 * Isotherme 0°C : altitude où il gèle. On prend la valeur de la mi-journée
 * (14h locale) ou la médiane à défaut. Utile en rando montagne pour évaluer
 * si la neige tient sur le parcours.
 */
export function freezingLevelOfDay(
  hourly: HourlyPoint[],
  dateIso: string,
): number | null {
  const dayPoints = hourly.filter((h) => h.time.startsWith(dateIso));
  if (dayPoints.length === 0) return null;
  const noon = dayPoints.find((h) => h.time.endsWith('T14:00'));
  const ref = noon ?? dayPoints[Math.floor(dayPoints.length / 2)];
  return ref?.freezingLevelM ?? null;
}
