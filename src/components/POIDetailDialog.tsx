import * as React from 'react';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Dialog, DialogContent, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { Loader2, ExternalLink, Plus, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { fetchComments, fetchPointFiche, refugesPhotoUrl } from '@/lib/refuges-api';
import { fetchBivouacFicheC2C } from '@/lib/camptocamp-api';
import { renderC2CMarkup } from '@/lib/c2c-markup';
import { dtSubtypeLabel } from '@/lib/datatourisme-api';
import { getTypeMeta } from '@/lib/types';
import { decodeHtmlEntities, formatDate } from '@/lib/format';
import { labelKey, labelValue, osmSubtitle } from '@/lib/osm-i18n';
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

  if (openCandidate?.source === 'c2c') {
    return (
      <C2CDetailDialog
        candidate={openCandidate}
        isSelected={selectedIds.has(openCandidate.id)}
        onToggleSelect={() => toggleSelected(openCandidate.id)}
        onClose={() => openDetail(null)}
      />
    );
  }

  if (openCandidate?.source === 'sncf') {
    return (
      <SNCFDetailDialog
        candidate={openCandidate}
        isSelected={selectedIds.has(openCandidate.id)}
        onToggleSelect={() => toggleSelected(openCandidate.id)}
        onClose={() => openDetail(null)}
      />
    );
  }

  if (openCandidate?.source === 'datatourisme') {
    return (
      <DatatourismeDetailDialog
        candidate={openCandidate}
        isSelected={selectedIds.has(openCandidate.id)}
        onToggleSelect={() => toggleSelected(openCandidate.id)}
        onClose={() => openDetail(null)}
      />
    );
  }

  if (openCandidate?.source === 'pan') {
    return (
      <PANArretDetailDialog
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
// Le mapping clé/valeur → FR vit dans lib/osm-i18n.ts et est partagé
// avec les autres sources OSM (eau, futurs commerces…).

// ─── Dialog Camptocamp ──────────────────────────────────────────────

function C2CDetailDialog({
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
  const nom = (p.nom as string) ?? 'Bivouac';
  const meta = getTypeMeta('c2c_bivouac');
  const alt = (p.coord as { alt?: number } | undefined)?.alt;
  const c2cId = p.c2cId as number | undefined;
  const summary = p.c2cSummary as string | undefined;
  const link = (p.lien as string | undefined) ?? '';

  const [fiche, setFiche] = React.useState<{
    description?: string;
    access?: string;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!c2cId) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchBivouacFicheC2C(c2cId, ctrl.signal)
      .then((data) => {
        if (data) setFiche({ description: data.description, access: data.access });
      })
      .catch(() => {
        /* affichage avec ce qu'on a déjà */
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [c2cId]);

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2.5 pr-8">
          {meta && <TypeIcon meta={meta} size={18} marker />}
          <span>{decodeHtmlEntities(nom)}</span>
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
            C2C
          </span>
        </DialogTitle>
        <div className="text-sm text-slate-500">
          bivouac{alt !== undefined && ` · ${alt} m`}
        </div>

        {summary && (
          <p className="text-sm font-medium text-slate-700">
            {decodeHtmlEntities(summary)}
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement de la fiche…
          </div>
        )}

        {fiche?.description && (
          <div>
            <div className="mb-1 text-sm font-semibold text-slate-700">Description</div>
            <div
              className="prose-fiche c2c-prose max-h-64 overflow-y-auto text-sm text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderC2CMarkup(fiche.description) }}
            />
          </div>
        )}

        {fiche?.access && (
          <div>
            <div className="mb-1 text-sm font-semibold text-slate-700">Accès</div>
            <div
              className="prose-fiche c2c-prose max-h-48 overflow-y-auto text-sm text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderC2CMarkup(fiche.access) }}
            />
          </div>
        )}

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            Fiche complète sur camptocamp.org <ExternalLink className="h-3 w-3" />
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

// ─── Dialog SNCF (gares de voyageurs, lecture statique) ─────────────

const SNCF_SEGMENT_LABEL: Record<string, string> = {
  A: 'Grande gare nationale',
  B: 'Gare régionale',
  C: 'Halte',
};

function SNCFDetailDialog({
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
  const nom = (p.nom as string) ?? 'Gare';
  const meta = getTypeMeta('sncf_gare');
  const uic = p.sncfUic as string | undefined;
  const lc = p.sncfLibelleCourt as string | undefined;
  const seg = p.sncfSegment as string | undefined;
  const segLabel = seg ? (SNCF_SEGMENT_LABEL[seg] ?? `Segment ${seg}`) : undefined;
  // Pas d'URL gare canonique côté SNCF Connect : la recherche Wikipédia est
  // le plus robuste compromis (la majorité des gares ont un article).
  const wikiSearch = `https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(
    `gare de ${nom}`,
  )}`;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2.5 pr-8">
          {meta && <TypeIcon meta={meta} size={18} marker />}
          <span>{decodeHtmlEntities(nom)}</span>
          <span className="rounded-sm bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-800">
            SNCF
          </span>
        </DialogTitle>
        <div className="text-sm text-slate-500">
          {segLabel ?? 'Gare de voyageurs'}
          {lc && ` · ${lc}`}
          {uic && ` · UIC ${uic}`}
        </div>

        <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <b>À vérifier :</b> ouverture saisonnière et horaires sur sncf-connect.com
          (certaines haltes ne sont pas desservies toute l'année).
        </div>

        <a
          href={wikiSearch}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
        >
          Chercher cette gare sur Wikipédia <ExternalLink className="h-3 w-3" />
        </a>

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

// ─── Dialog DATAtourisme (hébergements, lecture statique) ──────────

function DatatourismeDetailDialog({
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
  const nom = (p.nom as string) ?? 'Hébergement';
  const meta = getTypeMeta('dt_lodging');
  const sub = p.dtSubtype as string | undefined;
  const commune = p.dtCommune as string | undefined;
  const web = p.dtWeb as string | undefined;
  const subLabel = dtSubtypeLabel(sub);
  // Le code commune est de la forme "20260#Calvi" → on extrait "Calvi" pour
  // l'affichage et "20260" pour info code postal.
  const communeName = commune?.includes('#') ? commune.split('#')[1] : commune;
  const cp = commune?.includes('#') ? commune.split('#')[0] : undefined;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2.5 pr-8">
          {meta && <TypeIcon meta={meta} size={18} marker />}
          <span>{decodeHtmlEntities(nom)}</span>
          <span className="rounded-sm bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-800">
            DT
          </span>
        </DialogTitle>
        <div className="text-sm text-slate-500">
          {subLabel}
          {communeName && ` · ${decodeHtmlEntities(communeName)}`}
          {cp && ` (${cp})`}
        </div>

        <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <b>À vérifier :</b> ouverture saisonnière, tarifs et disponibilités à
          confirmer auprès de l'établissement. Données contribuées par les
          offices de tourisme via DATAtourisme.
        </div>

        {web && (
          <a
            href={web}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            Site officiel <ExternalLink className="h-3 w-3" />
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

// ─── Dialog Arrêts PAN (transport.data.gouv.fr, lecture statique) ──────

function PANArretDetailDialog({
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
  const nom = (p.nom as string) ?? 'Arrêt';
  const meta = getTypeMeta('pan_arret');
  const agencies = (p.panAgencies as string[] | undefined) ?? [];
  const lt = (p.panLocationType as number | undefined) ?? 0;
  const ltLabel = lt === 1 ? 'Pôle / gare routière' : 'Arrêt';
  // L'explorateur PAN (/explore/gtfs-stops) n'accepte pas de paramètre de
  // recherche → pas de deep-link possible vers un arrêt précis. On envoie
  // donc l'utilisateur sur une recherche Google ciblée "nom + réseau +
  // horaires", qui retombe dans 90% des cas sur le site officiel du réseau
  // opérateur, là où il trouvera les vrais horaires GTFS.
  const searchQuery = [nom, agencies[0], 'horaires'].filter(Boolean).join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2.5 pr-8">
          {meta && <TypeIcon meta={meta} size={18} marker />}
          <span>{decodeHtmlEntities(nom)}</span>
          <span className="rounded-sm bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-800">
            PAN
          </span>
        </DialogTitle>
        <div className="text-sm text-slate-500">{ltLabel}</div>

        {agencies.length > 0 && (
          <div className="text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Réseau{agencies.length > 1 ? 'x' : ''}
            </div>
            <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
              {agencies.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <b>À vérifier :</b> horaires, fréquence et exploitation saisonnière
          auprès du réseau opérateur. Les arrêts publiés sur le Point d'Accès
          National ne sont pas dédoublonnés en amont — un même arrêt physique
          peut apparaître plusieurs fois.
        </div>

        <a
          href={searchUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
        >
          Chercher les horaires sur le web <ExternalLink className="h-3 w-3" />
        </a>

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
  // Le typeKey distingue les sous-genres OSM (eau, commerce, pharmacie…) ;
  // il pilote le meta de marker, le libellé de fallback et l'avertissement
  // terrain. On lit directement la valeur OSM portée par la feature, avec
  // fallback `osm_water` pour conserver l'ancien comportement si un POI ne
  // porte pas de type explicite (ne devrait pas arriver en pratique).
  const rawValeur = (p.type as { valeur?: string } | undefined)?.valeur;
  const KNOWN_OSM: ReadonlyArray<string> = [
    'osm_water',
    'osm_shop',
    'osm_pharmacy',
    'osm_atm',
    'osm_toilets',
  ];
  const typeKey = (rawValeur && KNOWN_OSM.includes(rawValeur) ? rawValeur : 'osm_water') as
    | 'osm_water'
    | 'osm_shop'
    | 'osm_pharmacy'
    | 'osm_atm'
    | 'osm_toilets';
  const isShop = typeKey === 'osm_shop';
  const NOM_FALLBACK: Record<typeof typeKey, string> = {
    osm_water: "Point d'eau (OSM)",
    osm_shop: 'Commerce (OSM)',
    osm_pharmacy: 'Pharmacie (OSM)',
    osm_atm: 'Distributeur (OSM)',
    osm_toilets: 'Toilettes (OSM)',
  };
  const TERRAIN_WARNING: Record<typeof typeKey, string> = {
    osm_water:
      'la potabilité et le débit ne sont pas garantis. Les données OSM sont contribuées par la communauté.',
    osm_shop:
      'horaires et ouverture saisonnière variables, surtout en village de montagne. Données contribuées par la communauté OSM.',
    osm_pharmacy:
      "horaires et garde de nuit à vérifier ; en zone rurale, l'officine la plus proche peut être à plusieurs vallées. Données contribuées par la communauté OSM.",
    osm_atm:
      "fonctionnement et alimentation en billets non garantis hors saison. Prévoir un peu d'espèces avant de quitter une vallée. Données contribuées par la communauté OSM.",
    osm_toilets:
      "ouverture saisonnière fréquente, parfois fermées hors saison. Le tag `fee` indique si le passage est payant. Données contribuées par la communauté OSM.",
  };
  const nom = (p.nom as string) ?? NOM_FALLBACK[typeKey];
  const meta = getTypeMeta(typeKey);
  const alt = (p.coord as { alt?: number } | undefined)?.alt;
  const tags = (p.osmTags as Record<string, string> | undefined) ?? {};
  const subtype = p.osmSubtype as string | undefined;
  const link = (p.lien as string | undefined) ?? '';
  const osmId = p.osmId as number | undefined;
  const osmType = (p.osmType as 'node' | 'way' | undefined) ?? 'node';

  // Filtrer les tags pour affichage : exclure techniques + ceux déjà rendus
  const renderedTags = Object.entries(tags).filter(([k]) => {
    if (k === 'name') return false; // déjà dans le titre
    if (k === 'ele' && alt !== undefined) return false; // déjà dans le sous-titre
    if (k.startsWith('source:')) return false;
    if (k.startsWith('addr:')) return false;
    if (k === 'check_date' || k.startsWith('survey:')) return false;
    // Shops : on cache le tag structurant déjà rendu via le sous-titre.
    if (isShop && (k === 'shop' || k === 'amenity')) return false;
    // Idem pour les autres amenities : le tag `amenity` est déjà rendu en
    // sous-titre via osmSubtype.
    if (
      (typeKey === 'osm_pharmacy' || typeKey === 'osm_atm' || typeKey === 'osm_toilets') &&
      k === 'amenity'
    )
      return false;
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
          {subtype ?? osmSubtitle(tags)}
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
                  <dt className="text-slate-500">{labelKey(k)}</dt>
                  <dd className="text-slate-800">{labelValue(k, v)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}

        <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <b>À vérifier sur le terrain :</b> {TERRAIN_WARNING[typeKey]}
        </div>

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            Voir sur OpenStreetMap{osmId ? ` (${osmType} ${osmId})` : ''}{' '}
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
