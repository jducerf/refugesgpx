# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Action |
|---|---|
| `npm run dev` | Astro dev server (http://localhost:4321) |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Preview the built site |
| `npm run check` | `astro check` + `tsc --noEmit` — run after changes that touch types or `.astro` files |
| `npm run test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run format` | Prettier on `src/**/*.{ts,tsx,astro,css,md}` |

Run a single test file: `npx vitest run path/to/file.test.ts`. No test files exist yet — Vitest is wired up but the suite is empty.

Node 22 (see `netlify.toml`). Path alias: `@/*` → `src/*`.

## Architecture

**Stack**: Astro 6 SSG + React 19 islands + Tailwind 4 + TypeScript 6. **No backend** — everything runs in the browser; all data comes from public APIs (refuges.info, Overpass/OSM, Camptocamp). Deployed as a static site on Netlify.

**Exception**: a single Netlify Function (`netlify/functions/vigilance.ts`) proxies the Météo-France Vigilance API because that endpoint requires an application key (`METEO_FRANCE_API_KEY`) we can't expose in the bundle. The function caches in module scope + sets a `s-maxage=1800` so the upstream is barely touched. If the env var is missing, the function returns 503 and the UI section hides itself silently.

### Page model

Only two pages:

- `src/pages/index.astro` — server-rendered `<Landing>` for SEO, plus a `<AppShell client:only="react">` mount. Switching from landing → app is driven by adding `body.is-app` once a GPX is loaded (see `AppShell.tsx`).
- `src/pages/print.astro` — standalone print/topo view mounted as `<PrintView client:only="react">`. The main app hands data over via `localStorage` key `refuges-print-payload`, then opens `/print` in a new tab.
- `src/pages/og.png.ts` — prerendered OG image, built at build time with Satori + Resvg using fonts from `src/assets/fonts/`.

### State

A single Zustand store, `src/store/useAppStore.ts`, owns: parsed GPX trace, buffer step index, enabled type sets (refuges.info vs annex sources), candidate POIs from each source, selection, per-source loading/error flags, and `detailOpenId`. It also owns the pastoral overlay slice (`pastoralEnabled`, `pastoralDate`, `pastoralOnlyDogs`, `pastoralCount`, loading/error) — a separate concern from POIs (see *Pastoral overlay (MapPatou)*).

Important invariant: `setCandidates` / `setAnnexCandidates` automatically prune `selectedIds` to the union of currently-visible POIs (`pruneSelection`). This prevents disabling a source from leaving selection ghosts in the export.

### Data flow per source

`MapView` is the orchestrator. On trace change / buffer change / filter toggle, it:

1. Computes a bbox from the trace (`lib/geo.ts` → `traceBbox` → `expandBboxMeters`).
2. Hits the relevant fetcher in parallel:
   - `lib/refuges-api.ts` — refuges.info `/api/bbox`, `/api/point` (fiche), `/api/commentaires`.
   - `lib/overpass-api.ts` — water points + shops via Overpass QL.
   - `lib/camptocamp-api.ts` — bivouacs.
3. Filters the returned features to the trace buffer with `filterByDistance` (uses `turf.nearestPointOnLine` for true line-distance).
4. Writes `candidates` / `annexCandidates` to the store.

### POI types

`src/lib/types.ts` is the source of truth for type metadata (`TYPE_LABELS`). Each entry carries:
- `valeurAPI` — string used in refuges.info request and in GPX `<type>` tag,
- `color` + `iconKey` + `svgPath` — used both by `<TypeIcon>` (React) and the rasterized MapLibre markers (`lib/markers.ts`).

`REFUGES_TYPE_KEYS` are the five refuges.info categories (on by default minus `pt_passage`). `ANNEX_TYPE_KEYS` (`osm_water`, `c2c_bivouac`, `osm_shop`) are opt-in and stored separately so their loading and errors don't mix with the primary set.

To keep IDs unique across sources (they collide otherwise), OSM ways are offset by `1e10` and Camptocamp IDs by `1e12` inside their respective fetchers — search for `OFFSET` constants if working on selection/export.

### Caching

`src/lib/cache.ts` is a shared IndexedDB key/value layer used by every external API module. Two helpers worth knowing:

- `bboxToGridKey(bbox, step=0.02)` — snaps the bbox to a ~1.5 km grid so that slider tweaks reuse the same cache entry. The API is then queried with the grid bbox (slightly wider than the user's actual bbox), which is necessary for the cache hit to be correct.
- `TTL` — `BBOX: 24h`, `FICHE: 7d`, `COMMENTS: 1h`. Eviction is lazy on read.

Bumping `DB_VERSION` wipes the store on upgrade — do this if entry shapes change.

MapPatou is the odd one out: it caches the whole national response keyed by **requested date** (not a bbox grid), with its own 7-day TTL defined in `src/lib/mappatou-api.ts` rather than via `TTL`.

### Map rendering

`MapView.tsx` uses MapLibre with raw OSM raster tiles (`OSM_STYLE` constant — see README's "Fond de carte" section before swapping providers). POI layers use pre-rendered `icon-image` (from `lib/markers.ts`); no glyph PBF is loaded, so don't add `text-field` to a layer without also wiring up `glyphs`. The pastoral overlay adds its own `mappatou-fill` / `mappatou-line` polygon layers *beneath* the trace (see *Pastoral overlay (MapPatou)*).

### Pastoral overlay (MapPatou)

`src/lib/mappatou-api.ts` + dedicated `mappatou-fill` / `mappatou-line` layers in `MapView.tsx`. This is **not** a POI source — it's a MultiPolygon overlay (pastoral units + livestock-protection-dog presence; data: Pasto-Kezako / LESSEM-INRAE), entirely outside the candidates/selection/export pipeline, driven by its own store slice.

Gotchas, all learned the hard way:

- **The API filters by date server-side**, despite third-party docs claiming `date` is ignored. It always returns the ~5057 geometries, but `debut`/`fin`/`chiens`/`type_animal`/days are only populated for units grazed on the requested date (null otherwise). So we **fetch per `pastoralDate`** and re-fetch on change; the cache key is the date. A unit with null `debut`/`fin` is inactive that day → hidden.
- Client-side filtering to the trace: numeric bbox prefilter (per-feature bbox precomputed once) → `isUpActiveOn` → `turf.booleanIntersects` against the trace buffer.
- `surface` is **not** an area (it's a free string duplicating a zone name) — never display it.
- **Feature-flagged off in production**: `PASTORAL_FEATURE_ENABLED` (`= import.meta.env.PUBLIC_PASTORAL_LAYER === 'true' || import.meta.env.DEV`) gates the source, layers, click handlers, attribution and fetch. On in dev, off in prod until the data license is confirmed (see *Conventions*). Enable in prod via Netlify env `PUBLIC_PASTORAL_LAYER=true` — no code change.

### Exports

- GPX: `lib/exports.ts` → `buildEnrichedGpx` — emits the original trkpts unchanged + `<wpt>` per selected POI, with `<copyright>` reflecting which sources were actually used.
- PDF/Topo: triggered from `ExportButtons` → stashes `{ trace, pois }` in localStorage → opens `/print` → `PrintView` re-fetches fiches/comments per POI and renders the printable layout (`PrintMap` for the inset map).

### Conventions

- API responses are validated with **Zod** (`z.looseObject` everywhere) — keep schemas tolerant; the upstream APIs add fields without notice.
- UI primitives in `src/components/ui/` are Radix wrappers (Button, Checkbox, Dialog, ScrollArea, Slider). Use `cn()` from `lib/cn.ts` (clsx + tailwind-merge) for class composition.
- All user-facing strings are in French; keep that convention when adding UI.
- Data licensing is non-negotiable: any new source must be CC BY-SA-compatible and have its attribution surfaced on the map, in the GPX `<copyright>`, and in the PDF (see `exports.ts` `sourcesLabel` logic). **Exception in flight**: the MapPatou pastoral overlay ships gated **off in production** (`PASTORAL_FEATURE_ENABLED`) precisely because its license is not yet confirmed CC BY-SA-compatible — don't enable it in prod until that's cleared (see *Pastoral overlay (MapPatou)*).
