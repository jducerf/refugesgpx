import * as React from 'react';
import { Checkbox } from './ui/Checkbox';
import { ScrollArea } from './ui/ScrollArea';
import { TypeIcon } from './TypeIcon';
import { useAppStore } from '@/store/useAppStore';
import { getTypeMeta } from '@/lib/types';
import { decodeHtmlEntities, formatDistance } from '@/lib/format';
import { Loader2 } from 'lucide-react';

export function POIList() {
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const openDetail = useAppStore((s) => s.openDetail);
  const isLoading = useAppStore((s) => s.isLoadingPois);
  const apiError = useAppStore((s) => s.apiError);

  const merged = React.useMemo(
    () => [...candidates, ...annexCandidates].sort((a, b) => a.distM - b.distM),
    [candidates, annexCandidates],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">
          POIs à proximité (<b>{merged.length}</b>)
        </span>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      {apiError && (
        <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {apiError}
        </div>
      )}

      <ScrollArea className="-mr-2 min-h-32 flex-1 border-t border-slate-200 pt-1 pr-2">
        {merged.length === 0 && !isLoading && (
          <p className="px-1 py-3 text-center text-xs text-slate-400">
            Aucun POI dans la zone. Élargir la distance ou cocher d'autres types.
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {merged.map(({ feature: f, distM, id, source }) => {
            const t = f.properties.type?.valeur ?? '';
            const meta = getTypeMeta(t);
            const checked = selectedIds.has(id);
            const alt = f.properties.coord?.alt;
            const subtype = (f.properties as { osmSubtype?: string }).osmSubtype;
            const typeLabel =
              source === 'osm' && subtype ? subtype : decodeHtmlEntities(t);
            return (
              <li
                key={id}
                className="flex cursor-pointer items-start gap-2 px-1 py-2 hover:bg-slate-50"
                onClick={() => openDetail(id)}
              >
                <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleSelected(id)}
                    aria-label={`Sélectionner ${f.properties.nom}`}
                  />
                </div>
                {meta && <TypeIcon meta={meta} size={12} marker className="mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {decodeHtmlEntities(f.properties.nom)}
                    </div>
                    {source === 'osm' && (
                      <span className="shrink-0 rounded-sm bg-slate-200 px-1 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                        OSM
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {typeLabel}
                    {alt !== undefined && ` · ${alt} m`} ·{' '}
                    <b className="text-[var(--color-accent)]">{formatDistance(distM)} du tracé</b>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </section>
  );
}
