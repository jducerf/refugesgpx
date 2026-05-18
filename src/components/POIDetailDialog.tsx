import * as React from 'react';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Dialog, DialogContent, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { Loader2, ExternalLink, Plus, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { fetchComments, fetchPointFiche, refugesPhotoUrl } from '@/lib/refuges-api';
import { getTypeMeta } from '@/lib/types';
import { decodeHtmlEntities, formatDate } from '@/lib/format';
import { TypeIcon } from './TypeIcon';
import type { Comment, PoiCandidate, PoiFeature } from '@/lib/types';

export function POIDetailDialog() {
  const openId = useAppStore((s) => s.detailOpenId);
  const openDetail = useAppStore((s) => s.openDetail);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);

  // Retrouver le candidat ouvert pour connaître sa source
  const openCandidate: PoiCandidate | undefined = React.useMemo(() => {
    if (openId === null) return undefined;
    return (
      candidates.find((c) => c.id === openId) ??
      annexCandidates.find((c) => c.id === openId)
    );
  }, [openId, candidates, annexCandidates]);

  if (openCandidate?.source === 'osm') {
    return (
      <OSMDetailDialog
        candidate={openCandidate}
        isSelected={selectedIds.has(openCandidate.id)}
        onToggleSelect={() => toggleSelected(openCandidate.id)}
        onClose={() => openDetail(null)}
      />
    );
  }

  return (
    <RefugesDetailDialog
      openId={openId}
      isSelected={openId !== null && selectedIds.has(openId)}
      onToggleSelect={() => openId !== null && toggleSelected(openId)}
      onClose={() => openDetail(null)}
    />
  );
}

// ─── Dialog refuges.info (avec fetch fiche + commentaires) ──────────

function RefugesDetailDialog({
  openId,
  isSelected,
  onToggleSelect,
  onClose,
}: {
  openId: number | null;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClose: () => void;
}) {
  const [feature, setFeature] = React.useState<PoiFeature | null>(null);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (openId === null) {
      setFeature(null);
      setComments([]);
      setErr(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);
    setFeature(null);
    setComments([]);
    Promise.all([
      fetchPointFiche(openId, ctrl.signal),
      fetchComments(openId, ctrl.signal),
    ])
      .then(([fiche, cms]) => {
        setFeature(fiche);
        setComments(cms);
      })
      .catch((e) => {
        if (e.name !== 'AbortError')
          setErr(e instanceof Error ? e.message : 'Erreur chargement');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [openId]);

  const p = feature?.properties as Record<string, unknown> | undefined;
  const t = (p?.type as { valeur?: string } | undefined)?.valeur ?? '';
  const meta = getTypeMeta(t);
  const alt = (p?.coord as { alt?: number } | undefined)?.alt;
  const places =
    (p?.places as { valeur?: number; nb?: number } | undefined)?.valeur ??
    (p?.places as { valeur?: number; nb?: number } | undefined)?.nb;
  const descObj = p?.description as { valeur?: string } | string | undefined;
  const desc: string =
    typeof descObj === 'string' ? descObj : (descObj?.valeur ?? '');
  const accessObj = p?.acces as { valeur?: string } | string | undefined;
  const access: string =
    typeof accessObj === 'string' ? accessObj : (accessObj?.valeur ?? '');
  const equip: string = Array.isArray(p?.equipements)
    ? (p.equipements as Array<{ valeur?: string; nom?: string }>)
        .map((e) => e?.valeur ?? e?.nom ?? '')
        .filter(Boolean)
        .join(', ')
    : '';
  const link: string =
    (p?.lien as string | undefined) ??
    (openId ? `https://www.refuges.info/point/${openId}/` : '');

  return (
    <Dialog open={openId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {(loading || err || !feature) && (
          <VisuallyHidden.Root>
            <DialogTitle>Fiche d'un point d'intérêt</DialogTitle>
          </VisuallyHidden.Root>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement…
          </div>
        )}
        {err && <p className="text-red-600">{err}</p>}
        {feature && p && (
          <>
            <DialogTitle className="flex items-center gap-2.5 pr-8">
              {meta && <TypeIcon meta={meta} size={18} marker />}
              <span>{decodeHtmlEntities((p.nom as string) ?? '')}</span>
            </DialogTitle>
            <div className="text-sm text-slate-500">
              {decodeHtmlEntities(t)}
              {alt !== undefined && ` · ${alt} m`}
              {places && ` · ${places} places`}
            </div>

            {equip && (
              <div className="text-sm">
                <b className="text-slate-700">Équipements : </b>
                <span className="text-slate-600">{decodeHtmlEntities(equip)}</span>
              </div>
            )}

            {desc && (
              <div>
                <div className="mb-1 text-sm font-semibold text-slate-700">Description</div>
                <div
                  className="prose-fiche text-sm text-slate-700"
                  dangerouslySetInnerHTML={{ __html: desc }}
                />
              </div>
            )}

            {access && (
              <div>
                <div className="mb-1 text-sm font-semibold text-slate-700">Accès</div>
                <div
                  className="prose-fiche text-sm text-slate-700"
                  dangerouslySetInnerHTML={{ __html: access }}
                />
              </div>
            )}

            <a
              href={link}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
            >
              Fiche complète sur refuges.info <ExternalLink className="h-3 w-3" />
            </a>

            <div className="border-t border-slate-200 pt-3">
              <div className="mb-2 text-sm font-semibold text-slate-700">
                Derniers commentaires ({comments.length})
              </div>
              {comments.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun commentaire.</p>
              ) : (
                <ul className="space-y-3">
                  {comments.slice(0, 5).map((c) => (
                    <li key={c.id_commentaire} className="text-sm">
                      <div className="text-[11px] text-slate-500">
                        <b>{decodeHtmlEntities(c.auteur_commentaire || 'anon')}</b> · {formatDate(c.date_commentaire)}
                      </div>
                      <div
                        className="prose-fiche text-slate-700"
                        dangerouslySetInnerHTML={{ __html: c.texte_commentaire }}
                      />
                      {c['photo-reduite'] && (
                        <a
                          href={refugesPhotoUrl(c['photo-originale'] ?? c['photo-reduite'])}
                          target="_blank"
                          rel="noopener"
                          className="mt-1 inline-block"
                        >
                          <img
                            src={refugesPhotoUrl(c['photo-reduite'])}
                            alt=""
                            className="max-h-48 rounded border border-slate-200"
                            loading="lazy"
                          />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant={isSelected ? 'subtle' : 'primary'}
                onClick={() => {
                  onToggleSelect();
                  onClose();
                }}
              >
                {isSelected ? (
                  <>
                    <Check className="h-4 w-4" /> Retirer de l'export
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Ajouter à l'export
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog OSM (lecture locale des tags) ───────────────────────────

const TAG_LABELS: Record<string, string> = {
  natural: 'Type naturel',
  amenity: 'Amenity',
  man_made: 'Ouvrage',
  drinking_water: 'Eau potable',
  description: 'Description',
  operator: 'Gestionnaire',
  ele: 'Altitude (m)',
  intermittent: 'Intermittent',
  seasonal: 'Saisonnier',
  source: 'Source de la donnée',
  'name:fr': 'Nom (FR)',
  wikidata: 'Wikidata',
  fee: 'Payant',
  access: 'Accès',
};

function readableTagValue(key: string, val: string): string {
  if (val === 'yes') return 'oui';
  if (val === 'no') return 'non';
  if (val === 'permissive') return 'libre';
  if (val === 'private') return 'privé';
  if (key === 'ele') return `${Math.round(parseFloat(val))} m`;
  return val;
}

function OSMDetailDialog({
  candidate,
  isSelected,
  onToggleSelect,
  onClose,
}: {
  candidate: PoiCandidate;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClose: () => void;
}) {
  const f = candidate.feature;
  const p = f.properties as Record<string, unknown>;
  const nom = (p.nom as string) ?? "Point d'eau (OSM)";
  const meta = getTypeMeta('osm_water');
  const alt = (p.coord as { alt?: number } | undefined)?.alt;
  const tags = (p.osmTags as Record<string, string> | undefined) ?? {};
  const subtype = p.osmSubtype as string | undefined;
  const link = (p.lien as string | undefined) ?? '';
  const osmId = p.osmId as number | undefined;

  // Filtrer les tags pour affichage : exclure techniques + ceux déjà rendus
  const renderedTags = Object.entries(tags).filter(([k]) => {
    if (k === 'name') return false; // déjà dans le titre
    if (k === 'ele' && alt !== undefined) return false; // déjà dans le sous-titre
    if (k.startsWith('source:')) return false;
    if (k.startsWith('addr:')) return false;
    if (k === 'check_date' || k.startsWith('survey:')) return false;
    return true;
  });

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2.5 pr-8">
          {meta && <TypeIcon meta={meta} size={18} marker />}
          <span>{decodeHtmlEntities(nom)}</span>
          <span className="rounded-sm bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            OSM
          </span>
        </DialogTitle>
        <div className="text-sm text-slate-500">
          {subtype ?? "point d'eau"}
          {alt !== undefined && ` · ${alt} m`}
        </div>

        {tags.description && (
          <div>
            <div className="mb-1 text-sm font-semibold text-slate-700">Description</div>
            <div className="text-sm text-slate-700">{tags.description}</div>
          </div>
        )}

        {renderedTags.length > 0 && (
          <div className="border-t border-slate-200 pt-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">
              Tags OpenStreetMap
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {renderedTags.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-slate-500">{TAG_LABELS[k] ?? k}</dt>
                  <dd className="text-slate-800">{readableTagValue(k, v)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}

        <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <b>À vérifier sur le terrain :</b> la potabilité et le débit ne sont pas
          garantis. Les données OSM sont contribuées par la communauté.
        </div>

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            Voir sur OpenStreetMap{osmId ? ` (node ${osmId})` : ''}{' '}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <div className="flex justify-end pt-2">
          <Button
            variant={isSelected ? 'subtle' : 'primary'}
            onClick={() => {
              onToggleSelect();
              onClose();
            }}
          >
            {isSelected ? (
              <>
                <Check className="h-4 w-4" /> Retirer de l'export
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Ajouter à l'export
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
