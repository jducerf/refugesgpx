import { create } from 'zustand';
import type { ParsedGpx, PoiCandidate, TypeKey } from '@/lib/types';
import { REFUGES_TYPE_KEYS } from '@/lib/types';

interface AppState {
  trace: ParsedGpx | null;
  bufferStepIdx: number; // index dans BUFFER_STEPS
  enabledTypes: Set<TypeKey>;
  enabledAnnexTypes: Set<TypeKey>; // sources annexes (Overpass, etc.) — vide par défaut
  candidates: PoiCandidate[];
  annexCandidates: PoiCandidate[];
  selectedIds: Set<number>;
  isLoadingPois: boolean;
  isLoadingAnnex: boolean;
  apiError: string | null;
  annexError: string | null;
  detailOpenId: number | null;

  setTrace: (t: ParsedGpx | null) => void;
  setBufferStepIdx: (i: number) => void;
  toggleType: (k: TypeKey) => void;
  toggleAnnexType: (k: TypeKey) => void;
  setEnabledTypes: (s: Set<TypeKey>) => void;
  setCandidates: (c: PoiCandidate[]) => void;
  setAnnexCandidates: (c: PoiCandidate[]) => void;
  toggleSelected: (id: number) => void;
  clearSelected: () => void;
  setLoading: (b: boolean) => void;
  setAnnexLoading: (b: boolean) => void;
  setApiError: (e: string | null) => void;
  setAnnexError: (e: string | null) => void;
  openDetail: (id: number | null) => void;
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
  candidates: [],
  annexCandidates: [],
  selectedIds: new Set<number>(),
  isLoadingPois: false,
  isLoadingAnnex: false,
  apiError: null,
  annexError: null,
  detailOpenId: null,

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
    }),
}));
