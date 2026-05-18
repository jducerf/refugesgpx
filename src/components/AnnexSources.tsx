import { Loader2 } from 'lucide-react';
import { Checkbox } from './ui/Checkbox';
import { TypeIcon } from './TypeIcon';
import { useAppStore } from '@/store/useAppStore';
import { ANNEX_TYPE_KEYS, TYPE_LABELS, type TypeKey } from '@/lib/types';

export function AnnexSources() {
  const enabledAnnex = useAppStore((s) => s.enabledAnnexTypes);
  const toggleAnnex = useAppStore((s) => s.toggleAnnexType);
  const isLoading = useAppStore((s) => s.isLoadingAnnex);
  const error = useAppStore((s) => s.annexError);
  const annexCandidates = useAppStore((s) => s.annexCandidates);

  return (
    <section className="rounded-md border border-dashed border-[var(--color-paper-deep)] bg-[var(--color-paper-warm)]/50 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          Sources annexes
          <span className="rounded-sm bg-[var(--color-accent)]/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            beta
          </span>
        </div>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      </div>

      <div className="space-y-1.5">
        {ANNEX_TYPE_KEYS.map((k) => {
          const meta = TYPE_LABELS[k];
          const checked = enabledAnnex.has(k);
          const count = checked
            ? annexCandidates.filter(
                (c) => c.feature.properties.type?.valeur === meta.valeurAPI,
              ).length
            : null;
          return (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-2.5 text-slate-800"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleAnnex(k as TypeKey)}
              />
              <TypeIcon meta={meta} size={16} marker />
              <span className="text-xs">{meta.label}</span>
              {count !== null && !isLoading && (
                <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                  {count}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {error && (
        <div className="mt-1.5 rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">
          {error}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-tight text-slate-500">
        Données{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
          className="underline hover:text-[var(--color-accent)]"
        >
          OpenStreetMap
        </a>{' '}
        via Overpass. Couverture variable, vérifier sur le terrain.
      </p>
    </section>
  );
}
