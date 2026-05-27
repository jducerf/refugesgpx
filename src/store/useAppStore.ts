import { create } from 'zustand';
import type { DtGroup, ParsedGpx, PoiCandidate, TypeKey } from '@/lib/types';
import { DT_GROUP_ORDER, REFUGES_TYPE_KEYS } from '@/lib/types';
import { BASEMAPS, DEFAULT_BASEMAP, type BasemapId } from '@/lib/basemaps';
import { localTodayISO } from '@/lib/mappatou-api';

const BASEMAP_STORAGE_KEY = 'refuges-basemap';

function readStoredBasemap(): BasemapId {
  if (typeof window === 'undefined') return DEFAULT_BASEMAP;
  try {
    const raw = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    if (raw && raw in BASEMAPS) return raw as BasemapId;
  } catch {
    // localStorage indisponible (mode privé, quota) → on retombe sur le défaut.
  }
  return DEFAULT_BASEMAP;
}

function writeStoredBasemap(id: BasemapId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

interface AppState {
  trace: ParsedGpx | null;
  bufferStepIdx: number; // index dans BUFFER_STEPS
  enabledTypes: Set<TypeKey>;
  enabledAnnexTypes: Set<TypeKey>; // sources annexes (Overpass, etc.) — vide par défaut
  enabledDtGroups: Set<DtGroup>; // sous-groupes DATAtourisme — tous activés par défaut
  candidates: PoiCandidate[];
  annexCandidates: PoiCandidate[];
  selectedIds: Set<number>;
  isLoadingPois: boolean;
  isLoadingAnnex: boolean;
  apiError: string | null;
  annexError: string | null;
  detailOpenId: number | null;
  basemap: BasemapId;

  // ─── Zones pastorales (MapPatou) — couche overlay polygones, indépendante
  // du pipeline POI/sélection/export. Donnée fetchée par date (l'API filtre la
  // période d'estive côté serveur) puis filtrée par bbox de la trace.
  pastoralEnabled: boolean;
  pastoralDate: string; // YYYY-MM-DD — date de rando pour le filtre temporel
  pastoralOnlyDogs: boolean; // n'afficher que les UP avec chiens de protection
  pastoralCount: number; // nb d'UP visibles (après filtres) — pour l'UI
  isLoadingPastoral: boolean;
  pastoralError: string | null;

  setTrace: (t: ParsedGpx | null) => void;
  setBufferStepIdx: (i: number) => void;
  toggleType: (k: TypeKey) => void;
  toggleAnnexType: (k: TypeKey) => void;
  setEnabledTypes: (s: Set<TypeKey>) => void;
  /** Active/désactive en un coup un ensemble de TypeKey (catégorie). */
  setTypesEnabled: (keys: TypeKey[], enabled: boolean) => void;
  toggleDtGroup: (g: DtGroup) => void;
  setAllDtGroups: (enabled: boolean) => void;
  setCandidates: (c: PoiCandidate[]) => void;
  setAnnexCandidates: (c: PoiCandidate[]) => void;
  toggleSelected: (id: number) => void;
  clearSelected: () => void;
  setLoading: (b: boolean) => void;
  setAnnexLoading: (b: boolean) => void;
  setApiError: (e: string | null) => void;
  setAnnexError: (e: string | null) => void;
  openDetail: (id: number | null) => void;
  setBasemap: (id: BasemapId) => void;
  setPastoralEnabled: (b: boolean) => void;
  setPastoralDate: (d: string) => void;
  setPastoralOnlyDogs: (b: boolean) => void;
  setPastoralCount: (n: number) => void;
  setPastoralLoading: (b: boolean) => void;
  setPastoralError: (e: string | null) => void;
  reset: () => void;
}

/** Garde uniquement les IDs sélectionnés qui sont encore visibles dans
 * l'union (candidates + annexCandidates). Évite que désactiver une source
 * laisse des "fantômes" dans l'export. */
function pruneSelection(
  selected: Set<number>,
  refuges: PoiCandidate[],
  annex: PoiCandidate[],
): Set<number> {
  const visible = new Set<number>();
  for (const c of refuges) visible.add(c.id);
  for (const c of annex) visible.add(c.id);
  const next = new Set<number>();
  selected.forEach((id) => {
    if (visible.has(id)) next.add(id);
  });
  return next;
}

export const useAppStore = create<AppState>((set) => ({
  trace: null,
  bufferStepIdx: 2, // 500 m par défaut
  enabledTypes: new Set<TypeKey>(['refuge', 'cabane', 'gite', 'pt_eau']),
  enabledAnnexTypes: new Set<TypeKey>(),
  enabledDtGroups: new Set<DtGroup>(DT_GROUP_ORDER),
  candidates: [],
  annexCandidates: [],
  selectedIds: new Set<number>(),
  isLoadingPois: false,
  isLoadingAnnex: false,
  apiError: null,
  annexError: null,
  detailOpenId: null,
  basemap: readStoredBasemap(),
  pastoralEnabled: false,
  pastoralDate: localTodayISO(),
  pastoralOnlyDogs: false,
  pastoralCount: 0,
  isLoadingPastoral: false,
  pastoralError: null,

  setTrace: (t) =>
    set({
      trace: t,
      candidates: [],
      annexCandidates: [],
      selectedIds: new Set(),
    }),
  setBufferStepIdx: (i) => set({ bufferStepIdx: i }),
  toggleType: (k) =>
    set((s) => {
      const next = new Set(s.enabledTypes);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { enabledTypes: next };
    }),
  toggleAnnexType: (k) =>
    set((s) => {
      const next = new Set(s.enabledAnnexTypes);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { enabledAnnexTypes: next };
    }),
  setEnabledTypes: (s) => set({ enabledTypes: s }),
  setTypesEnabled: (keys, enabled) =>
    set((s) => {
      // Sépare automatiquement les types principaux des annexes. La distinction
      // continue d'exister dans le store (pour ne pas casser MapView qui les
      // fetche en deux pipelines), même si l'UI les présente regroupés.
      const REFUGES = new Set<TypeKey>([
        'refuge',
        'cabane',
        'gite',
        'pt_eau',
        'pt_passage',
      ]);
      const nextMain = new Set(s.enabledTypes);
      const nextAnnex = new Set(s.enabledAnnexTypes);
      for (const k of keys) {
        const bucket = REFUGES.has(k) ? nextMain : nextAnnex;
        if (enabled) bucket.add(k);
        else bucket.delete(k);
      }
      return { enabledTypes: nextMain, enabledAnnexTypes: nextAnnex };
    }),
  toggleDtGroup: (g) =>
    set((s) => {
      const next = new Set(s.enabledDtGroups);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return { enabledDtGroups: next };
    }),
  setAllDtGroups: (enabled) =>
    set(() => ({
      enabledDtGroups: enabled ? new Set<DtGroup>(DT_GROUP_ORDER) : new Set<DtGroup>(),
    })),
  setCandidates: (c) =>
    set((s) => ({
      candidates: c,
      selectedIds: pruneSelection(s.selectedIds, c, s.annexCandidates),
    })),
  setAnnexCandidates: (c) =>
    set((s) => ({
      annexCandidates: c,
      selectedIds: pruneSelection(s.selectedIds, s.candidates, c),
    })),
  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  clearSelected: () => set({ selectedIds: new Set() }),
  setLoading: (b) => set({ isLoadingPois: b }),
  setAnnexLoading: (b) => set({ isLoadingAnnex: b }),
  setApiError: (e) => set({ apiError: e }),
  setAnnexError: (e) => set({ annexError: e }),
  openDetail: (id) => set({ detailOpenId: id }),
  setBasemap: (id) => {
    writeStoredBasemap(id);
    set({ basemap: id });
  },
  setPastoralEnabled: (b) =>
    set(
      b
        ? { pastoralEnabled: true }
        : { pastoralEnabled: false, pastoralError: null, pastoralCount: 0 },
    ),
  setPastoralDate: (d) => set({ pastoralDate: d }),
  setPastoralOnlyDogs: (b) => set({ pastoralOnlyDogs: b }),
  setPastoralCount: (n) => set({ pastoralCount: n }),
  setPastoralLoading: (b) => set({ isLoadingPastoral: b }),
  setPastoralError: (e) => set({ pastoralError: e }),
  reset: () =>
    set({
      trace: null,
      candidates: [],
      annexCandidates: [],
      selectedIds: new Set(),
      apiError: null,
      annexError: null,
      detailOpenId: null,
      enabledTypes: new Set<TypeKey>(REFUGES_TYPE_KEYS.filter((t) => t !== 'pt_passage')),
      enabledAnnexTypes: new Set<TypeKey>(),
      enabledDtGroups: new Set<DtGroup>(DT_GROUP_ORDER),
      pastoralEnabled: false,
      pastoralOnlyDogs: false,
      pastoralCount: 0,
      pastoralError: null,
    }),
}));
