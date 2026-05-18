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
import type { Comment, PoiFeature } from '@/lib/types';

export function POIDetailDialog() {
  const openId = useAppStore((s) => s.detailOpenId);
  const openDetail = useAppStore((s) => s.openDetail);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const toggleSelected = useAppStore((s) => s.toggleSelected);

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

  const handleClose = (open: boolean) => {
    if (!open) openDetail(null);
  };

  const p = feature?.properties as any;
  const t = p?.type?.valeur ?? '';
  const meta = getTypeMeta(t);
  const alt = p?.coord?.alt;
  const places = p?.places?.valeur ?? p?.places?.nb;
  const desc: string =
    (p?.description?.valeur ?? p?.description ?? '') as string;
  const access: string = (p?.acces?.valeur ?? p?.acces ?? '') as string;
  const equip: string =
    Array.isArray(p?.equipements)
      ? p.equipements
          .map((e: any) => e?.valeur ?? e?.nom ?? '')
          .filter(Boolean)
          .join(', ')
      : '';
  const link: string =
    p?.lien ?? (openId ? `https://www.refuges.info/point/${openId}/` : '');

  const isSel = openId !== null && selectedIds.has(openId);

  return (
    <Dialog open={openId !== null} onOpenChange={handleClose}>
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
              <span>{decodeHtmlEntities(p.nom)}</span>
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
                variant={isSel ? 'subtle' : 'primary'}
                onClick={() => {
                  if (openId !== null) toggleSelected(openId);
                  openDetail(null);
                }}
              >
                {isSel ? (
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
