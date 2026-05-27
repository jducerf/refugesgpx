import * as React from 'react';
import { ChevronDown, Dog, Info, Loader2, SlidersHorizontal } from 'lucide-react';
import { Slider } from './ui/Slider';
import { Checkbox } from './ui/Checkbox';
import { TypeIcon } from './TypeIcon';
import { useAppStore } from '@/store/useAppStore';
import {
  BUFFER_STEPS,
  CATEGORY_META,
  CATEGORY_ORDER,
  CATEGORY_TO_TYPES,
  DT_GROUPS,
  DT_GROUP_ORDER,
  TYPE_LABELS,
  type Category,
  type DtGroup,
  type TypeKey,
} from '@/lib/types';
import { PASTORAL_FEATURE_ENABLED } from '@/lib/mappatou-api';
import { cn } from '@/lib/cn';

/** Étiquettes utilisateur pour chaque source individuelle. */
const SOURCE_LABEL: Record<TypeKey, string> = {
  refuge: 'Refuges gardés',
  cabane: 'Cabanes non gardées',
  gite: "Gîtes d'étape",
  pt_eau: "Points d'eau",
  pt_passage: 'Passages délicats',
  osm_water: 'Sources / fontaines',
  c2c_bivouac: 'Bivouacs',
  osm_shop: 'Commerces',
  sncf_gare: 'Gares SNCF',
  dt_lodging: 'Hébergements payants',
  osm_pharmacy: 'Pharmacies',
  osm_atm: 'Distributeurs',
  osm_toilets: 'Toilettes publiques',
  pan_arret: 'Arrêts bus / cars',
};

const SOURCE_ORIGIN: Record<TypeKey, string> = {
  refuge: 'refuges.info',
  cabane: 'refuges.info',
  gite: 'refuges.info',
  pt_eau: 'refuges.info',
  pt_passage: 'refuges.info',
  osm_water: 'OSM',
  c2c_bivouac: 'Camptocamp',
  osm_shop: 'OSM',
  sncf_gare: 'SNCF',
  dt_lodging: 'DATAtourisme',
  osm_pharmacy: 'OSM',
  osm_atm: 'OSM',
  osm_toilets: 'OSM',
  pan_arret: 'transport.data.gouv.fr',
};

function useIsTypeActive(typeKey: TypeKey): boolean {
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const enabledAnnex = useAppStore((s) => s.enabledAnnexTypes);
  return enabledTypes.has(typeKey) || enabledAnnex.has(typeKey);
}

function useCount(valeur: string): number {
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  return React.useMemo(() => {
    let n = 0;
    for (const c of candidates) {
      if (c.feature.properties.type?.valeur === valeur) n++;
    }
    for (const c of annexCandidates) {
      if (c.feature.properties.type?.valeur === valeur) n++;
    }
    return n;
  }, [valeur, candidates, annexCandidates]);
}

// ─── Composants ────────────────────────────────────────────────

/** Petit bouton (i) qui ouvre un popover compact avec les attributions des
 * sources et l'avertissement "vérifier sur le terrain". Click outside ferme.
 * Remplace le bandeau de texte qui occupait 3 lignes sous les filtres. */
function SourcesInfo() {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Détail des sources de données"
        aria-expanded={open}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700',
          open && 'bg-slate-100 text-slate-700',
        )}
      >
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Données ouvertes
          </p>
          <p className="text-[11px] leading-snug text-slate-700">
            <a
              href="https://www.refuges.info"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              refuges.info
            </a>{' '}
            ·{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              OpenStreetMap
            </a>{' '}
            ·{' '}
            <a
              href="https://www.camptocamp.org"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              Camptocamp
            </a>{' '}
            ·{' '}
            <a
              href="https://www.data.gouv.fr/datasets/gares-de-voyageurs-1"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              SNCF
            </a>{' '}
            ·{' '}
            <a
              href="https://www.datatourisme.fr"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              DATAtourisme
            </a>{' '}
            ·{' '}
            <a
              href="https://transport.data.gouv.fr"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              transport.data.gouv.fr
            </a>
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-700">
            Zones pastorales :{' '}
            <a
              href="https://www.pasto-kezako.fr/mappatou-carte/"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              Pasto-Kezako
            </a>{' '}
            / LESSEM (INRAE)
          </p>
          <p className="mt-1.5 text-[10px] italic leading-snug text-slate-500">
            Toujours vérifier sur le terrain : ouvertures, sources, accès et
            tarifs varient.
          </p>
        </div>
      )}
    </div>
  );
}


/** Ligne d'une source individuelle : pastille couleur, checkbox, label,
 * origine, count. Variante spéciale pour `dt_lodging` qui expose en plus
 * un bouton de filtrage par sous-groupe (Hôtels / Refuges privés / etc.). */
function SourceRow({ typeKey }: { typeKey: TypeKey }) {
  const meta = TYPE_LABELS[typeKey];
  const active = useIsTypeActive(typeKey);
  const setTypesEnabled = useAppStore((s) => s.setTypesEnabled);
  const count = useCount(meta.valeurAPI);
  const [dtPanelOpen, setDtPanelOpen] = React.useState(false);
  const isDt = typeKey === 'dt_lodging';

  return (
    <div>
      <label
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-slate-50',
          active && 'text-slate-900',
          !active && 'text-slate-600',
        )}
      >
        <Checkbox
          checked={active}
          onCheckedChange={(v) => setTypesEnabled([typeKey], v === true)}
        />
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: meta.color }}
          aria-hidden
        />
        <span className="flex-1 truncate text-sm leading-tight">
          {SOURCE_LABEL[typeKey]}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {SOURCE_ORIGIN[typeKey]}
        </span>
        {active && count > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-slate-700">
            {count}
          </span>
        )}
        {isDt && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDtPanelOpen((v) => !v);
            }}
            aria-label="Filtrer par type d'hébergement"
            aria-expanded={dtPanelOpen}
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700',
              dtPanelOpen && 'bg-slate-200 text-slate-700',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </label>

      {isDt && dtPanelOpen && (
        <div className="ml-7 mt-1 mb-1 space-y-1 border-l-2 border-slate-200 pl-3">
          <div className="flex items-center justify-between pr-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Filtrer par type
            </span>
            <DtBulkToggle />
          </div>
          {DT_GROUP_ORDER.map((g) => (
            <DtGroupRow key={g} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function DtBulkToggle() {
  const enabled = useAppStore((s) => s.enabledDtGroups);
  const setAll = useAppStore((s) => s.setAllDtGroups);
  const allOn = enabled.size === DT_GROUP_ORDER.length;
  return (
    <button
      type="button"
      onClick={() => setAll(!allOn)}
      className="text-[10px] text-slate-500 hover:text-[var(--color-accent)]"
    >
      {allOn ? 'Tout décocher' : 'Tout cocher'}
    </button>
  );
}

function DtGroupRow({ group }: { group: DtGroup }) {
  const enabled = useAppStore((s) => s.enabledDtGroups);
  const toggle = useAppStore((s) => s.toggleDtGroup);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  const meta = DT_GROUPS[group];
  const active = enabled.has(group);

  const count = React.useMemo(() => {
    const subs = new Set(meta.subtypes);
    let n = 0;
    for (const c of annexCandidates) {
      const p = c.feature.properties as {
        type?: { valeur?: string };
        dtSubtype?: string;
      };
      if (p.type?.valeur === 'dt_lodging' && p.dtSubtype && subs.has(p.dtSubtype))
        n++;
    }
    return n;
  }, [meta.subtypes, annexCandidates]);

  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900">
      <Checkbox checked={active} onCheckedChange={() => toggle(group)} />
      <span className="flex-1 truncate">{meta.label}</span>
      {active && count > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-slate-600">
          {count}
        </span>
      )}
    </label>
  );
}

/** Titre de catégorie avec icône Lucide + indicateur "X/Y" + chevron.
 * Repliée par défaut pour préserver la place verticale dédiée à la liste
 * des POIs en dessous : l'utilisateur voit immédiatement l'état (X actives
 * sur Y disponibles) sans déplier, et ouvre uniquement la section qu'il
 * souhaite modifier. */
function CategorySection({ cat }: { cat: Category }) {
  const [open, setOpen] = React.useState(false);
  const meta = CATEGORY_META[cat];
  const types = CATEGORY_TO_TYPES[cat];
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const enabledAnnex = useAppStore((s) => s.enabledAnnexTypes);
  const setTypesEnabled = useAppStore((s) => s.setTypesEnabled);
  const activeCount = types.filter(
    (k) => enabledTypes.has(k) || enabledAnnex.has(k),
  ).length;
  const allOn = activeCount === types.length;
  const allOff = activeCount === 0;

  const fakeMeta = {
    id: 0,
    label: '',
    valeurAPI: '',
    color: 'currentColor',
    iconKey: meta.iconKey,
    svgPath: '',
  };

  // Toggle "tout" : si déjà tout actif, on désactive toutes les sources de
  // la catégorie ; sinon, on les active toutes. Pas d'expand de la section
  // dans ce cas — on agit sans révéler le détail.
  const handleBulkToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTypesEnabled(types, !allOn);
  };

  return (
    <div className="rounded border border-slate-100">
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
        <TypeIcon
          meta={fakeMeta}
          size={13}
          className={cn(allOn ? 'text-[var(--color-accent)]' : 'text-slate-500')}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          {meta.label}
        </span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none',
            allOn && 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
            !allOn && !allOff && 'bg-slate-100 text-slate-700',
            allOff && 'bg-slate-50 text-slate-400',
          )}
        >
          {activeCount}/{types.length}
        </span>
        <span className="flex-1" />
        {/* Toggle rapide "Tout / Aucun" sans déplier la section.
            S'affiche au hover de la rangée pour ne pas saturer visuellement. */}
        <button
          type="button"
          onClick={handleBulkToggle}
          className="opacity-0 transition-opacity text-[10px] text-slate-500 hover:text-[var(--color-accent)] group-hover:opacity-100"
          tabIndex={-1}
        >
          {allOn ? 'Aucun' : 'Tout'}
        </button>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-slate-400 transition-transform group-hover:text-slate-600',
            !open && '-rotate-90',
          )}
        />
      </div>
      {open && (
        <div className="space-y-0.5 border-t border-slate-100 px-1.5 py-1">
          {types.map((k) => (
            <SourceRow key={k} typeKey={k} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Zones pastorales (MapPatou) ────────────────────────────────
// Couche overlay polygones, distincte du système de POI : toggle dédié,
// sélecteur de date de rando (l'API filtre la période côté serveur) et option
// « uniquement les zones avec chiens de protection ».
function PastoralSection() {
  const enabled = useAppStore((s) => s.pastoralEnabled);
  const setEnabled = useAppStore((s) => s.setPastoralEnabled);
  const date = useAppStore((s) => s.pastoralDate);
  const setDate = useAppStore((s) => s.setPastoralDate);
  const onlyDogs = useAppStore((s) => s.pastoralOnlyDogs);
  const setOnlyDogs = useAppStore((s) => s.setPastoralOnlyDogs);
  const count = useAppStore((s) => s.pastoralCount);
  const loading = useAppStore((s) => s.isLoadingPastoral);
  const error = useAppStore((s) => s.pastoralError);

  return (
    <div className="rounded border border-slate-100">
      <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors hover:bg-slate-50">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        <Dog className="h-3.5 w-3.5 text-[#7c3aed]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Zones pastorales
        </span>
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-label="Chargement" />
        )}
        {enabled && !loading && count > 0 && (
          <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-slate-700">
            {count}
          </span>
        )}
      </label>

      {enabled && (
        <div className="space-y-2 border-t border-slate-100 px-2.5 py-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-slate-600">
              Date de la rando
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-800 focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded px-0.5 py-0.5 text-sm text-slate-600 hover:text-slate-900">
            <Checkbox checked={onlyDogs} onCheckedChange={(v) => setOnlyDogs(v === true)} />
            <span className="flex-1">Uniquement les zones avec chiens</span>
          </label>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-[#7c3aed]" aria-hidden />
              avec chiens (patou)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-[#f59e0b]" aria-hidden />
              sans chiens
            </span>
          </div>

          {error && (
            <div className="rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">{error}</div>
          )}

          <p className="text-[10px] leading-snug text-slate-400">
            Données :{' '}
            <a
              href="https://www.pasto-kezako.fr/mappatou-carte/"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-accent)]"
            >
              Pasto-Kezako
            </a>{' '}
            / LESSEM (INRAE). Présence indicative — restez prudent près des troupeaux.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ───────────────────────────────────────

export function Filters() {
  const bufferStepIdx = useAppStore((s) => s.bufferStepIdx);
  const setBufferStepIdx = useAppStore((s) => s.setBufferStepIdx);
  const isLoadingAnnex = useAppStore((s) => s.isLoadingAnnex);
  const annexError = useAppStore((s) => s.annexError);

  return (
    <section className="space-y-4">
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

      {/* Sources groupées par besoin */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-700">Sources</span>
          <SourcesInfo />
          {isLoadingAnnex && (
            <Loader2
              className="ml-auto h-3 w-3 animate-spin text-slate-400"
              aria-label="Chargement"
            />
          )}
        </div>

        <div className="space-y-1">
          {CATEGORY_ORDER.map((cat) => (
            <CategorySection key={cat} cat={cat} />
          ))}
        </div>

        {annexError && (
          <div className="mt-2 rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">
            {annexError}
          </div>
        )}

        {PASTORAL_FEATURE_ENABLED && (
          <div className="mt-1">
            <PastoralSection />
          </div>
        )}
      </div>
    </section>
  );
}
