import * as React from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from './ui/Button';
import { useAppStore } from '@/store/useAppStore';
import { buildEnrichedGpx, downloadFile, slugify } from '@/lib/exports';

const PRINT_STORAGE_KEY = 'refuges-print-payload';

export function ExportButtons() {
  const trace = useAppStore((s) => s.trace);
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  const selectedIds = useAppStore((s) => s.selectedIds);

  if (!trace) return null;

  const selectedCandidates = [...candidates, ...annexCandidates].filter((c) =>
    selectedIds.has(c.id),
  );
  const hasSel = selectedCandidates.length > 0;

  const handleGpx = () => {
    const gpx = buildEnrichedGpx(trace, selectedCandidates);
    downloadFile(`${slugify(trace.name)}_enrichi.gpx`, gpx, 'application/gpx+xml');
  };

  const handlePrint = () => {
    const payload = {
      trace,
      pois: selectedCandidates.map((c) => ({
        feature: c.feature,
        distM: c.distM,
        source: c.source,
      })),
    };
    sessionStorage.setItem(PRINT_STORAGE_KEY, JSON.stringify(payload));
    window.open('/print', '_blank');
  };

  return (
    <section className="space-y-2 border-t border-slate-200 pt-3">
      <Button
        variant="primary"
        className="w-full"
        onClick={handleGpx}
        disabled={!hasSel}
      >
        <Download className="h-4 w-4" />
        Exporter GPX ({selectedCandidates.length} POIs)
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={handlePrint}
        disabled={!hasSel}
      >
        <Printer className="h-4 w-4" />
        Exporter le topo PDF
      </Button>
      {!hasSel && (
        <p className="text-center text-[11px] text-slate-400">
          Cocher au moins un POI pour activer l'export.
        </p>
      )}
    </section>
  );
}

export { PRINT_STORAGE_KEY };
