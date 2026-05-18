import { useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import type { ParsedGpx, PoiFeature, Comment } from '@/lib/types';
import { getTypeMeta } from '@/lib/types';
import { TypeIcon } from './TypeIcon';
import { traceLengthKm, traceElevationStats } from '@/lib/geo';
import { fetchComments, fetchPointFiche, refugesPhotoUrl } from '@/lib/refuges-api';
import { decodeHtmlEntities, formatDate, formatDistance } from '@/lib/format';
import { Button } from './ui/Button';
import { PrintMap } from './PrintMap';

const PRINT_STORAGE_KEY = 'refuges-print-payload';

interface Payload {
  trace: ParsedGpx;
  pois: { feature: PoiFeature; distM: number }[];
}

interface Enriched {
  feature: PoiFeature;
  fiche: PoiFeature | null;
  comments: Comment[];
  distM: number;
  error?: string;
}

export function PrintView() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [items, setItems] = useState<Enriched[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [didPrint, setDidPrint] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(PRINT_STORAGE_KEY);
    if (!raw) {
      setLoadingData(false);
      return;
    }
    try {
      setPayload(JSON.parse(raw) as Payload);
    } catch {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!payload) return;
    const ctrl = new AbortController();
    (async () => {
      const enriched: Enriched[] = await Promise.all(
        payload.pois.map(async ({ feature, distM }) => {
          const idCandidate =
            feature.properties.id ?? (typeof feature.id === 'number' ? feature.id : NaN);
          if (!Number.isFinite(idCandidate)) {
            return { feature, fiche: null, comments: [], distM, error: 'id manquant' };
          }
          try {
            const [fiche, comments] = await Promise.all([
              fetchPointFiche(idCandidate, ctrl.signal),
              fetchComments(idCandidate, ctrl.signal),
            ]);
            return { feature, fiche, comments, distM };
          } catch (e) {
            return {
              feature,
              fiche: null,
              comments: [],
              distM,
              error: e instanceof Error ? e.message : 'err',
            };
          }
        }),
      );
      setItems(enriched);
      setLoadingData(false);
    })();
    return () => ctrl.abort();
  }, [payload]);

  // Print : on attend que les données ET la carte soient prêtes
  useEffect(() => {
    if (!loadingData && payload && items.length > 0 && mapReady && !didPrint) {
      setDidPrint(true);
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }
  }, [loadingData, payload, items, mapReady, didPrint]);

  if (!payload) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Aucun topo à imprimer</h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          Cette page doit être ouverte depuis l'application.
        </p>
        <Button className="mt-4" onClick={() => (window.location.href = '/')}>
          Retour à l'application
        </Button>
      </div>
    );
  }

  if (loadingData) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-[var(--color-ink-mute)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Préparation du topo…
      </div>
    );
  }

  const km = traceLengthKm(payload.trace).toFixed(1);
  const elev = traceElevationStats(payload.trace);
  const today = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-[var(--color-ink)] print:p-0">
      <div className="no-print mb-5 flex items-center justify-between gap-4 border-b border-[var(--color-paper-deep)] pb-3">
        <span className="text-sm text-[var(--color-ink-mute)]">
          Aperçu avant impression — <kbd className="rounded border border-[var(--color-paper-deep)] bg-[var(--color-paper-warm)] px-1 text-xs">Cmd/Ctrl + P</kbd> ou bouton ci-contre.
        </span>
        <button onClick={() => window.print()} className="btn-ink">
          <Printer className="h-4 w-4" /> Imprimer
        </button>
      </div>

      <header className="mb-6 border-b-2 border-[var(--color-ink)] pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="section-num">Topo — {today}</p>
          <p className="text-xs text-[var(--color-ink-mute)]">Refuges.GPX</p>
        </div>
        <h1 className="font-display mt-2 text-3xl font-semibold leading-tight md:text-4xl">
          {decodeHtmlEntities(payload.trace.name)}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {payload.trace.points.length} points · <b>{km} km</b>
          {elev.ascent > 0 && (
            <>
              {' '}
              · <b>{elev.ascent} m D+</b> / <b>{elev.descent} m D−</b>
              {' '}· min {elev.min} m, max {elev.max} m
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          <b>{items.length}</b> POI{items.length > 1 ? 's' : ''} sélectionné{items.length > 1 ? 's' : ''}
        </p>
      </header>

      {/* ─── Carte miniature ─────────────────────────────────────── */}
      <div className="mb-7">
        <PrintMap
          trace={payload.trace}
          pois={payload.pois}
          width={720}
          height={360}
          onReady={() => setMapReady(true)}
        />
      </div>

      <ol className="space-y-7">
        {items.map((item, idx) => {
          const fallbackId =
            (item.feature.properties.id as number | undefined) ??
            (typeof item.feature.id === 'number' ? item.feature.id : idx);
          const p = item.fiche?.properties ?? item.feature.properties;
          const t = p.type?.valeur ?? '';
          const meta = getTypeMeta(t);
          const alt = p.coord?.alt;
          const places = (p as any).places?.valeur ?? (p as any).places?.nb;
          const desc: string =
            ((p as any).description?.valeur ?? (p as any).description ?? '') as string;
          const access: string =
            ((p as any).acces?.valeur ?? (p as any).acces ?? '') as string;
          const equip = Array.isArray((p as any).equipements)
            ? (p as any).equipements
                .map((e: any) => e?.valeur ?? e?.nom)
                .filter(Boolean)
                .join(', ')
            : '';
          return (
            <li
              key={fallbackId}
              className="break-inside-avoid border-l-2 border-[var(--color-accent)] pl-4 print:break-inside-avoid"
            >
              <h2 className="font-display flex items-center gap-2 text-xl font-semibold leading-tight">
                <span className="text-[var(--color-ink-mute)]">{idx + 1}.</span>
                {meta && <TypeIcon meta={meta} size={14} marker />}
                <span>{decodeHtmlEntities(p.nom)}</span>
              </h2>
              <p className="text-xs text-[var(--color-ink-soft)]">
                {decodeHtmlEntities(t)}
                {alt !== undefined && ` · ${alt} m`}
                {places && ` · ${places} places`} ·{' '}
                <b>{formatDistance(item.distM)} du tracé</b>
              </p>

              {equip && (
                <p className="mt-1.5 text-sm">
                  <b>Équipements :</b> {decodeHtmlEntities(equip)}
                </p>
              )}

              {desc && (
                <div className="mt-2">
                  <div className="section-num text-[10px]">Description</div>
                  <div
                    className="prose-print text-sm"
                    dangerouslySetInnerHTML={{ __html: desc }}
                  />
                </div>
              )}

              {access && (
                <div className="mt-2">
                  <div className="section-num text-[10px]">Accès</div>
                  <div
                    className="prose-print text-sm"
                    dangerouslySetInnerHTML={{ __html: access }}
                  />
                </div>
              )}

              {item.comments.length > 0 && (
                <div className="mt-2 rounded bg-[var(--color-paper-warm)] p-2 print:border print:border-[var(--color-paper-deep)] print:bg-transparent">
                  <div className="section-num text-[10px]">
                    Derniers commentaires ({item.comments.length})
                  </div>
                  <ul className="mt-1 space-y-2">
                    {item.comments.slice(0, 3).map((c) => (
                      <li key={c.id_commentaire} className="text-sm">
                        <div className="text-[11px] text-[var(--color-ink-mute)]">
                          <b>{decodeHtmlEntities(c.auteur_commentaire || 'anon')}</b> ·{' '}
                          {formatDate(c.date_commentaire)}
                        </div>
                        <div
                          className="prose-print"
                          dangerouslySetInnerHTML={{ __html: c.texte_commentaire }}
                        />
                        {c['photo-reduite'] && (
                          <img
                            src={refugesPhotoUrl(c['photo-reduite'])}
                            alt=""
                            className="mt-1 max-h-32 rounded"
                            loading="lazy"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {p.lien && (
                <p className="mt-2 text-[11px] text-[var(--color-ink-mute)]">
                  Fiche complète : {p.lien}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <footer className="mt-10 border-t border-[var(--color-paper-deep)] pt-3 text-[11px] text-[var(--color-ink-mute)]">
        Données © refuges.info contributors — CC BY-SA 2.0 · Fond © OpenStreetMap contributors · Généré avec Refuges.GPX (refuges.yoandev.co)
      </footer>
    </div>
  );
}
