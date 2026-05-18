import { Loader2 } from 'lucide-react';
import { Slider } from './ui/Slider';
import { TypeIcon } from './TypeIcon';
import { useAppStore } from '@/store/useAppStore';
import {
  ANNEX_TYPE_KEYS,
  BUFFER_STEPS,
  REFUGES_TYPE_KEYS,
  TYPE_LABELS,
  type TypeKey,
  type TypeMeta,
} from '@/lib/types';
import { cn } from '@/lib/cn';

/** Étiquettes courtes adaptées aux pills (5-12 chars). */
const SHORT_LABEL: Record<TypeKey, string> = {
  refuge: 'Refuges',
  cabane: 'Cabanes',
  gite: 'Gîtes',
  pt_eau: 'Eau',
  pt_passage: 'Passages',
  osm_water: 'Eau OSM',
  c2c_bivouac: 'Bivouacs',
  osm_shop: 'Ravitaillement',
};

interface PillProps {
  meta: TypeMeta;
  label: string;
  active: boolean;
  count: number | null;
  variant?: 'main' | 'annex';
  onClick: () => void;
}

function Pill({ meta, label, active, count, variant = 'main', onClick }: PillProps) {
  // Active : tint de la couleur du type (12,5% opacity) + border + texte = couleur du type
  // Inactive : fond paper, border sobre, texte mute (et un point coloré pour rappeler le type)
  // Active : tint ~22% + border colorée pleine + texte légèrement plus foncé que la border
  const activeStyle = active
    ? {
        backgroundColor: meta.color + '38',
        borderColor: meta.color,
        color: meta.color,
      }
    : {};

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${meta.label}${count !== null ? ` — ${count} dans la zone` : ''}`}
      style={activeStyle}
      className={cn(
        'group inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors select-none',
        variant === 'annex' ? 'border-[1.5px] border-dashed' : 'border',
        !active &&
          'border-[var(--color-paper-deep)] bg-white text-[var(--color-ink-soft)] hover:border-slate-400 hover:text-slate-800',
      )}
    >
      {active ? (
        <TypeIcon meta={meta} size={12} marker />
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full opacity-60 group-hover:opacity-100"
          style={{ backgroundColor: meta.color }}
          aria-hidden
        />
      )}
      <span className="leading-none">{label}</span>
      {count !== null && count > 0 && (
        <span
          className="rounded-full px-1 text-[10px] font-semibold tabular-nums leading-tight"
          style={{
            backgroundColor: active ? meta.color + '33' : 'rgb(241 245 249)',
            color: active ? meta.color : 'rgb(100 116 139)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function Filters() {
  const bufferStepIdx = useAppStore((s) => s.bufferStepIdx);
  const setBufferStepIdx = useAppStore((s) => s.setBufferStepIdx);
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const toggleType = useAppStore((s) => s.toggleType);
  const enabledAnnex = useAppStore((s) => s.enabledAnnexTypes);
  const toggleAnnex = useAppStore((s) => s.toggleAnnexType);
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  const isLoadingAnnex = useAppStore((s) => s.isLoadingAnnex);
  const annexError = useAppStore((s) => s.annexError);

  const countMain = (valeur: string) =>
    candidates.filter((c) => c.feature.properties.type?.valeur === valeur).length;
  const countAnnex = (valeur: string) =>
    annexCandidates.filter((c) => c.feature.properties.type?.valeur === valeur).length;

  return (
    <section className="space-y-3">
      {/* Slider distance */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">Distance du tracé</span>
          <span className="text-sm font-semibold text-[var(--color-accent)]">
            {BUFFER_STEPS[bufferStepIdx]?.label}
          </span>
        </div>
        <Slider
          min={0}
          max={BUFFER_STEPS.length - 1}
          step={1}
          value={[bufferStepIdx]}
          onValueChange={([v]) => v !== undefined && setBufferStepIdx(v)}
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
          <span>100 m</span>
          <span>5 km</span>
        </div>
      </div>

      {/* Pills sources */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-700">Sources</span>
          {isLoadingAnnex && (
            <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-label="Chargement" />
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {REFUGES_TYPE_KEYS.map((k) => {
            const meta = TYPE_LABELS[k];
            const active = enabledTypes.has(k);
            return (
              <Pill
                key={k}
                meta={meta}
                label={SHORT_LABEL[k]}
                active={active}
                count={active ? countMain(meta.valeurAPI) : null}
                onClick={() => toggleType(k as TypeKey)}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            + annexes
          </span>
          {ANNEX_TYPE_KEYS.map((k) => {
            const meta = TYPE_LABELS[k];
            const active = enabledAnnex.has(k);
            return (
              <Pill
                key={k}
                meta={meta}
                label={SHORT_LABEL[k]}
                active={active}
                count={active ? countAnnex(meta.valeurAPI) : null}
                variant="annex"
                onClick={() => toggleAnnex(k as TypeKey)}
              />
            );
          })}
        </div>

        {annexError && (
          <div className="rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">
            {annexError}
          </div>
        )}

        <p className="text-[10px] leading-tight text-slate-500">
          Annexes opt-in : eau via{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener"
            className="underline hover:text-[var(--color-accent)]"
          >
            OpenStreetMap
          </a>{' '}
          · bivouacs via{' '}
          <a
            href="https://www.camptocamp.org"
            target="_blank"
            rel="noopener"
            className="underline hover:text-[var(--color-accent)]"
          >
            Camptocamp
          </a>
          . Vérifier sur le terrain.
        </p>
      </div>
    </section>
  );
}
