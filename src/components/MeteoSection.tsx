import * as React from 'react';
import {
  ChevronDown,
  CloudSun,
  Cloud,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Sun,
  Loader2,
  Droplets,
  Wind,
  Snowflake,
  MapPin,
  Flag,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  fetchVigilance,
  traceDepartements,
  COLOR_LABELS,
  HIKING_PHENOMENA,
  type Echeance,
  type VigilancePeriod,
  type VigilanceSnapshot,
} from '@/lib/vigilance-api';
import {
  fetchForecast,
  freezingLevelOfDay,
  weatherMeta,
  type DailyForecast,
  type HourlyPoint,
  type PointForecast,
  type WeatherIconKey,
} from '@/lib/openmeteo-api';
import { cn } from '@/lib/cn';

type AnchorKey = 'depart' | 'arrivee';

/**
 * Section "Météo" du panel — agrège deux sources :
 *  - Vigilance Météo-France (J et J+1) via notre proxy Netlify ;
 *  - Open-Meteo (prévisions J à J+6, horaire, par POI) en direct depuis le
 *    navigateur (API gratuite sans clé, CORS).
 *
 * Trois "points de météo" possibles :
 *  - Départ de la trace (toujours affiché).
 *  - Arrivée de la trace (affichée seulement si distincte du départ ≥ 100 m,
 *    donc cachée sur les boucles).
 *  - Chaque POI sélectionné (ligne dépliable pour voir le 7 jours du POI).
 *
 * Dégrade silencieusement si une source est indisponible (proxy Vigilance
 * non configuré, Open-Meteo HS, etc.).
 */
export function MeteoSection() {
  const trace = useAppStore((s) => s.trace);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);

  const [open, setOpen] = React.useState(false);

  // Vigilance Météo-France
  const [vigLoading, setVigLoading] = React.useState(false);
  const [vigError, setVigError] = React.useState<string | null>(null);
  const [snap, setSnap] = React.useState<VigilanceSnapshot | null>(null);
  const [deptCodes, setDeptCodes] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<Echeance>('J');

  // Open-Meteo — départ + (éventuellement) arrivée
  const [departForecast, setDepartForecast] = React.useState<PointForecast | null>(null);
  const [arriveeForecast, setArriveeForecast] = React.useState<PointForecast | null>(null);
  const [omLoading, setOmLoading] = React.useState(false);
  const [anchor, setAnchor] = React.useState<AnchorKey>('depart');

  // Boucle vs traversée : si le dernier point est à moins de 100 m du premier,
  // on considère que c'est la même météo et on n'affiche pas le toggle.
  const hasDistinctEnd = React.useMemo(() => {
    if (!trace || trace.points.length < 2) return false;
    const start = trace.points[0];
    const end = trace.points[trace.points.length - 1];
    if (!start || !end) return false;
    return haversineMeters(start.lon, start.lat, end.lon, end.lat) >= 100;
  }, [trace]);

  React.useEffect(() => {
    if (!trace || trace.points.length === 0) {
      setSnap(null);
      setDeptCodes([]);
      setVigError(null);
      setDepartForecast(null);
      setArriveeForecast(null);
      setAnchor('depart');
      return;
    }
    const ctrl = new AbortController();
    setVigLoading(true);
    setOmLoading(true);
    setVigError(null);

    const start = trace.points[0];
    const end = trace.points[trace.points.length - 1];
    if (!start) return;
    const coords: Array<[number, number]> = [[start.lon, start.lat]];
    if (hasDistinctEnd && end) coords.push([end.lon, end.lat]);

    // Vigilance + départements en parallèle, Open-Meteo séparé.
    void (async () => {
      try {
        const [depts, vig] = await Promise.all([
          traceDepartements(trace, ctrl.signal),
          fetchVigilance(ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        setDeptCodes(depts);
        setSnap(vig);
      } catch (e) {
        if (!ctrl.signal.aborted) setVigError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setVigLoading(false);
      }
    })();

    void (async () => {
      try {
        const res = await fetchForecast(coords, { forecastDays: 7 }, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setDepartForecast(res[0] ?? null);
        setArriveeForecast(coords.length > 1 ? (res[1] ?? null) : null);
      } catch {
        if (!ctrl.signal.aborted) {
          setDepartForecast(null);
          setArriveeForecast(null);
        }
      } finally {
        if (!ctrl.signal.aborted) setOmLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [trace, hasDistinctEnd]);

  // Météo par POI sélectionné — fetch en multi-coords, 7 jours pour permettre
  // le détail dépliable. Pas de hourly (la trace fournit déjà le détail
  // horaire au départ ; au-delà, payload inutile).
  //
  // On capture aussi l'altitude réelle du POI (refuges.info la renseigne
  // dans coord.alt). Sans ça, on serait obligé d'afficher l'altitude du
  // modèle Open-Meteo — qui est l'altitude moyenne de la maille (~1-2 km)
  // et qui colle plusieurs POIs voisins à la même valeur, donnant
  // l'impression à tort qu'ils sont à la même altitude.
  const [poiForecasts, setPoiForecasts] = React.useState<
    Array<{
      id: number;
      nom: string;
      altitude: number | null;
      forecast: PointForecast;
    }>
  >([]);

  React.useEffect(() => {
    if (selectedIds.size === 0) {
      setPoiForecasts([]);
      return;
    }
    const allCands = [...candidates, ...annexCandidates];
    const selected = allCands.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) {
      setPoiForecasts([]);
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const coords: Array<[number, number]> = selected.map((c) => [
          c.feature.geometry.coordinates[0],
          c.feature.geometry.coordinates[1],
        ]);
        const res = await fetchForecast(
          coords,
          { hourly: false, forecastDays: 7 },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        setPoiForecasts(
          selected
            .map((c, i) => {
              const fc = res[i];
              if (!fc) return null;
              const props = c.feature.properties;
              const alt = typeof props.coord?.alt === 'number' ? props.coord.alt : null;
              return {
                id: c.id,
                nom: props.nom,
                altitude: alt,
                forecast: fc,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        );
      } catch {
        if (!ctrl.signal.aborted) setPoiForecasts([]);
      }
    })();
    return () => ctrl.abort();
  }, [selectedIds, candidates, annexCandidates]);

  if (!trace) return null;
  if (vigError && !snap && !departForecast) return null;

  // Forecast actif selon le toggle Départ/Arrivée. On retombe sur Départ si
  // l'arrivée n'est pas disponible (loop) ou pas encore chargée.
  const currentForecast =
    anchor === 'arrivee' && arriveeForecast ? arriveeForecast : departForecast;

  // ─── Calculs Vigilance ──────────────────────────────────────────────
  const periodMax = (period: VigilancePeriod | undefined): number =>
    period
      ? deptCodes.reduce(
          (m, c) => Math.max(m, period.byDept.get(c)?.maxColor ?? 0),
          0,
        )
      : 0;
  const periodJ = snap?.periods.find((p) => p.echeance === 'J');
  const periodJ1 = snap?.periods.find((p) => p.echeance === 'J1');
  const overallMax = Math.max(periodMax(periodJ), periodMax(periodJ1));
  const overallMeta = COLOR_LABELS[overallMax];
  const activePeriod = active === 'J' ? periodJ : periodJ1;
  const vigRows = deptCodes
    .map((code) => activePeriod?.byDept.get(code))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const loading = vigLoading || omLoading;

  return (
    <section className="rounded border border-slate-100">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
      >
        <CloudSun className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Météo
        </span>
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-label="Chargement" />
        )}
        {!vigLoading && deptCodes.length > 0 && overallMeta && (
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
            style={{
              backgroundColor: overallMeta.hex + '20',
              color: overallMeta.hex,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: overallMeta.hex }}
              aria-hidden
            />
            {overallMeta.label}
          </span>
        )}
        {!vigLoading && deptCodes.length > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-slate-600">
            {deptCodes.length} dépt
          </span>
        )}
        <span className="flex-1" />
        <ChevronDown
          className={cn(
            'h-3 w-3 text-slate-400 transition-transform group-hover:text-slate-600',
            !open && '-rotate-90',
          )}
        />
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-2 py-2">
          {/* ─── Vigilance Météo-France ─── */}
          {vigLoading && (
            <p className="text-[11px] text-slate-500">Chargement de la vigilance…</p>
          )}

          {!vigLoading && snap && periodJ && (
            <div className="space-y-1.5">
              <EcheanceTabs
                active={active}
                onChange={setActive}
                jMax={periodMax(periodJ)}
                j1Max={periodMax(periodJ1)}
              />
              {vigRows.length === 0 && deptCodes.length > 0 && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Aucune vigilance détectée sur les départements de la trace.
                </p>
              )}
              {vigRows.map((r) => (
                <DeptRow key={r.deptCode} dept={r} />
              ))}
            </div>
          )}

          {/* ─── Sélecteur Départ/Arrivée + prévisions ─── */}
          {currentForecast && (
            <div className="space-y-2">
              {hasDistinctEnd && arriveeForecast ? (
                <AnchorPills
                  anchor={anchor}
                  onChange={setAnchor}
                  departElevation={departForecast?.elevation ?? null}
                  arriveeElevation={arriveeForecast.elevation}
                />
              ) : (
                <AnchorLabel elevation={currentForecast.elevation} />
              )}

              {currentForecast.daily[0] && <IndicesBanner forecast={currentForecast} />}

              {currentForecast.daily.length > 0 && (
                <DailyForecastList daily={currentForecast.daily} />
              )}

              {currentForecast.hourly.length > 0 && (
                <HourlyDetail hourly={currentForecast.hourly} />
              )}
            </div>
          )}

          {/* ─── Météo par POI sélectionné ─── */}
          {poiForecasts.length > 0 && <PoiWeatherList items={poiForecasts} />}

          {/* ─── Attributions ─── */}
          <p className="pt-1 text-[10px] italic leading-snug text-slate-400">
            {snap?.updateTime && (
              <>
                Bulletin Météo-France du {formatUpdate(snap.updateTime)} ·{' '}
                <a
                  href="https://vigilance.meteofrance.fr/fr"
                  target="_blank"
                  rel="noopener"
                  className="underline hover:text-[var(--color-accent)]"
                >
                  voir le détail officiel
                </a>{' '}
                ·{' '}
              </>
            )}
            Prévisions{' '}
            <a
              href="https://open-meteo.com"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              Open-Meteo
            </a>{' '}
            (CC BY 4.0)
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Sous-composants Vigilance ────────────────────────────────────────────

function EcheanceTabs({
  active,
  onChange,
  jMax,
  j1Max,
}: {
  active: Echeance;
  onChange: (e: Echeance) => void;
  jMax: number;
  j1Max: number;
}) {
  return (
    <div className="flex gap-1">
      <TabButton active={active === 'J'} max={jMax} onClick={() => onChange('J')}>
        Aujourd'hui
      </TabButton>
      <TabButton active={active === 'J1'} max={j1Max} onClick={() => onChange('J1')}>
        Demain
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  max,
  onClick,
  children,
}: {
  active: boolean;
  max: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const meta = COLOR_LABELS[max];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-slate-300 bg-slate-100 text-slate-900'
          : 'border-slate-100 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700',
      )}
    >
      <span>{children}</span>
      {meta && max > 0 && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: meta.hex }}
          aria-label={meta.label}
        />
      )}
    </button>
  );
}

function DeptRow({
  dept,
}: {
  dept: {
    deptCode: string;
    maxColor: number;
    phenomena: Array<{ id: string; label: string; color: number }>;
  };
}) {
  const colorMeta = COLOR_LABELS[dept.maxColor];
  const significant = dept.phenomena
    .filter((p) => p.color >= 2)
    .sort((a, b) => {
      const aPrio = HIKING_PHENOMENA.has(a.id) ? 0 : 1;
      const bPrio = HIKING_PHENOMENA.has(b.id) ? 0 : 1;
      if (aPrio !== bPrio) return aPrio - bPrio;
      return b.color - a.color;
    });

  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-0.5 inline-flex h-4 w-9 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none text-white"
        style={{ backgroundColor: colorMeta?.hex ?? '#94a3b8' }}
        title={`${colorMeta?.label ?? '—'} en ${dept.deptCode}`}
      >
        {dept.deptCode}
      </span>
      <div className="min-w-0 flex-1">
        {significant.length === 0 ? (
          <span className="text-[11px] text-slate-500">Rien à signaler</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {significant.map((p) => {
              const pc = COLOR_LABELS[p.color];
              return (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                  style={{
                    borderColor: pc?.hex ?? '#cbd5e1',
                    color: pc?.hex ?? '#475569',
                  }}
                >
                  <span
                    className="h-1 w-1 rounded-full"
                    style={{ backgroundColor: pc?.hex ?? '#cbd5e1' }}
                    aria-hidden
                  />
                  {p.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants Open-Meteo ───────────────────────────────────────────

const WEATHER_ICONS: Record<WeatherIconKey, React.ComponentType<{ className?: string }>> = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain,
  'cloud-rain-heavy': CloudRain,
  'cloud-snow': CloudSnow,
  'cloud-lightning': CloudLightning,
  'cloud-fog': CloudFog,
};

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  const meta = weatherMeta(code);
  const Icon = WEATHER_ICONS[meta.icon];
  return <Icon className={className} aria-label={meta.label} />;
}

function AnchorLabel({ elevation }: { elevation: number | null }) {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      <MapPin className="h-3 w-3" />
      <span>Au point de départ</span>
      {elevation !== null && (
        <span className="text-slate-400">· {Math.round(elevation)} m</span>
      )}
    </p>
  );
}

function AnchorPills({
  anchor,
  onChange,
  departElevation,
  arriveeElevation,
}: {
  anchor: AnchorKey;
  onChange: (a: AnchorKey) => void;
  departElevation: number | null;
  arriveeElevation: number | null;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Point de météo
      </p>
      <div className="flex gap-1">
        <AnchorPill
          active={anchor === 'depart'}
          onClick={() => onChange('depart')}
          icon={<MapPin className="h-3 w-3" />}
          label="Départ"
          elevation={departElevation}
        />
        <AnchorPill
          active={anchor === 'arrivee'}
          onClick={() => onChange('arrivee')}
          icon={<Flag className="h-3 w-3" />}
          label="Arrivée"
          elevation={arriveeElevation}
        />
      </div>
    </div>
  );
}

function AnchorPill({
  active,
  onClick,
  icon,
  label,
  elevation,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  elevation: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-slate-300 bg-slate-100 text-slate-900'
          : 'border-slate-100 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700',
      )}
    >
      {icon}
      <span>{label}</span>
      {elevation !== null && (
        <span className="text-slate-400 tabular-nums">{Math.round(elevation)}m</span>
      )}
    </button>
  );
}

function IndicesBanner({ forecast }: { forecast: PointForecast }) {
  const today = forecast.daily[0];
  if (!today) return null;
  const iso0 = freezingLevelOfDay(forecast.hourly, today.date);

  return (
    <div className="flex flex-wrap gap-1.5 rounded bg-slate-50 px-2 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Indices
      </span>
      {today.uvMax !== null && today.uvMax > 0 && (
        <Pill icon={<Sun className="h-3 w-3" />} label={`UV ${today.uvMax.toFixed(0)}`} />
      )}
      {iso0 !== null && (
        <Pill
          icon={<Snowflake className="h-3 w-3" />}
          label={`Iso 0°C ${Math.round(iso0)}m`}
        />
      )}
      {today.gustMaxKmh !== null && today.gustMaxKmh > 0 && (
        <Pill
          icon={<Wind className="h-3 w-3" />}
          label={`Raf. ${Math.round(today.gustMaxKmh)} km/h`}
        />
      )}
      {today.snowfallCm !== null && today.snowfallCm > 0 && (
        <Pill
          icon={<CloudSnow className="h-3 w-3" />}
          label={`Neige ${today.snowfallCm.toFixed(1)} cm`}
        />
      )}
    </div>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] leading-none text-slate-700">
      <span className="text-slate-500">{icon}</span>
      {label}
    </span>
  );
}

function DailyForecastList({ daily }: { daily: DailyForecast[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        7 prochains jours
      </p>
      <div className="space-y-0.5">
        {daily.map((d, i) => (
          <DailyRow key={d.date} day={d} index={i} />
        ))}
      </div>
    </div>
  );
}

function DailyRow({ day, index }: { day: DailyForecast; index: number }) {
  const meta = weatherMeta(day.weathercode);
  return (
    <div className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-slate-50">
      <span className="w-12 shrink-0 text-slate-700">{formatDayLabel(day.date, index)}</span>
      <WeatherIcon code={day.weathercode} className="h-3.5 w-3.5 shrink-0 text-slate-600" />
      <span className="w-16 shrink-0 tabular-nums text-slate-700" title={meta.label}>
        {Math.round(day.tMin)}°/{Math.round(day.tMax)}°
      </span>
      {day.precipMm > 0 ? (
        <span
          className="inline-flex items-center gap-0.5 tabular-nums text-blue-600"
          title={
            day.precipProbPct !== null ? `${day.precipProbPct}% de probabilité` : undefined
          }
        >
          <Droplets className="h-3 w-3" />
          {day.precipMm.toFixed(1)}
          <span className="text-slate-400">mm</span>
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      )}
      <span className="ml-auto inline-flex items-center gap-0.5 tabular-nums text-slate-500">
        <Wind className="h-3 w-3" />
        {Math.round(day.windMaxKmh)}
        <span className="text-slate-400">km/h</span>
      </span>
    </div>
  );
}

function HourlyDetail({ hourly }: { hourly: HourlyPoint[] }) {
  const [openHourly, setOpenHourly] = React.useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayHours = hourly.filter((h) => h.time.startsWith(todayIso));
  if (todayHours.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpenHourly((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
      >
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', !openHourly && '-rotate-90')}
        />
        Aujourd'hui heure par heure
      </button>
      {openHourly && (
        <div className="mt-1 grid grid-cols-4 gap-1">
          {todayHours.map((h) => (
            <HourCell key={h.time} hour={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function HourCell({ hour }: { hour: HourlyPoint }) {
  const time = hour.time.slice(11, 16);
  return (
    <div className="flex items-center gap-1 rounded bg-slate-50 px-1 py-0.5 text-[10px] tabular-nums">
      <span className="text-slate-500">{time}</span>
      <WeatherIcon code={hour.weathercode} className="h-3 w-3 shrink-0 text-slate-600" />
      <span className="text-slate-800">{Math.round(hour.temp)}°</span>
    </div>
  );
}

function PoiWeatherList({
  items,
}: {
  items: Array<{ id: number; nom: string; altitude: number | null; forecast: PointForecast }>;
}) {
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Météo aux POIs sélectionnés ({items.length})
      </p>
      <div className="space-y-0.5">
        {items.map((it) => (
          <PoiWeatherRow
            key={it.id}
            item={it}
            expanded={expandedId === it.id}
            onToggle={() => setExpandedId(expandedId === it.id ? null : it.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PoiWeatherRow({
  item,
  expanded,
  onToggle,
}: {
  item: { id: number; nom: string; altitude: number | null; forecast: PointForecast };
  expanded: boolean;
  onToggle: () => void;
}) {
  const today = item.forecast.daily[0];
  if (!today) return null;

  // Affichage : altitude réelle du POI quand on l'a (refuges.info la fournit
  // via coord.alt). Sinon on retombe sur l'altitude du modèle Open-Meteo
  // (commune à la maille ~1-2 km, donc parfois identique pour des POIs
  // voisins — d'où l'importance de privilégier coord.alt quand dispo).
  const altDisplay = item.altitude ?? item.forecast.elevation;
  const altTitle =
    item.altitude !== null
      ? "Altitude du POI"
      : 'Altitude du modèle Open-Meteo (le POI ne renseigne pas la sienne)';

  return (
    <div className="rounded border border-transparent transition-colors hover:border-slate-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-[11px] hover:bg-slate-50"
      >
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-slate-400 transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <WeatherIcon code={today.weathercode} className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        <span className="min-w-0 flex-1 truncate text-slate-700" title={item.nom}>
          {item.nom}
        </span>
        {altDisplay !== null && (
          <span
            className="shrink-0 tabular-nums text-slate-400"
            title={altTitle}
          >
            {Math.round(altDisplay)}m
          </span>
        )}
        <span className="shrink-0 tabular-nums text-slate-700">
          {Math.round(today.tMin)}°/{Math.round(today.tMax)}°
        </span>
      </button>

      {expanded && (
        <div className="ml-5 mt-1 mb-1.5 space-y-0.5 border-l-2 border-slate-100 pl-2">
          {item.forecast.daily.map((d, i) => (
            <DailyRow key={d.date} day={d} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatUpdate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDayLabel(dateIso: string, index: number): string {
  if (index === 0) return 'Auj.';
  if (index === 1) return 'Demain';
  try {
    const d = new Date(dateIso + 'T00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  } catch {
    return dateIso;
  }
}

/** Haversine, mètres. Utilisé seulement pour décider départ vs arrivée. */
function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
