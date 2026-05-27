import * as React from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import type { FeatureCollection } from 'geojson';
import { useAppStore } from '@/store/useAppStore';
import {
  bufferLine,
  expandBboxMeters,
  filterByDistance,
  traceBbox,
  traceToLine,
} from '@/lib/geo';
import {
  fetchMapPatou,
  isUpActiveOn,
  animalLabel,
  presentDaysSummary,
  MAPPATOU_ATTRIBUTION,
  PASTORAL_FEATURE_ENABLED,
  type MapPatouFeature,
  type MapPatouProperties,
} from '@/lib/mappatou-api';
import { fetchPOIsInBbox } from '@/lib/refuges-api';
import { fetchWaterPointsOSM, fetchShopsOSM, fetchAmenitiesOSM } from '@/lib/overpass-api';
import { fetchBivouacsC2C } from '@/lib/camptocamp-api';
import { fetchGaresSNCF } from '@/lib/transports-api';
import { fetchDatatourismeLodging } from '@/lib/datatourisme-api';
import { fetchArretsPAN } from '@/lib/arrets-pan-api';
import { BUFFER_STEPS, DT_GROUPS, TYPE_LABELS, type TypeKey } from '@/lib/types';
import type { PoiCandidate } from '@/lib/types';
import { loadAllMarkerImages } from '@/lib/markers';
import { BASEMAPS, type BasemapId } from '@/lib/basemaps';
import { cn } from '@/lib/cn';

const BASEMAP_SHORT_LABEL: Record<BasemapId, string> = {
  osm: 'OSM',
  'ign-plan': 'Plan IGN',
  'ign-ortho': 'Photo IGN',
};

/**
 * `'style.load'` est un event MapLibre valide qui fire après qu'un nouveau
 * style est complètement chargé suite à `setStyle()` — c'est ce qu'on veut.
 * Il n'est en revanche pas listé dans le typedef public, d'où le cast.
 */
const STYLE_LOAD_EVENT = 'style.load' as unknown as 'styledata';

/**
 * Pousse la trace courante dans la source `trace` à partir de l'état du store.
 * Utilisé après un swap de fond pour rétablir le rendu sans dépendre d'un
 * re-fire des effets React (qui sont gateé sur `isStyleLoaded`).
 */
function pushTraceFromStore(map: maplibregl.Map) {
  const state = useAppStore.getState();
  const src = map.getSource('trace') as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  if (!state.trace) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  const line = traceToLine(state.trace);
  const buffer = bufferLine(line, BUFFER_STEPS[state.bufferStepIdx]?.meters ?? 500);
  src.setData({ type: 'FeatureCollection', features: [line, buffer] });
}

/**
 * Pousse les POIs courants dans la source `pois`. Même logique que
 * `pushTraceFromStore` — utilisé après un swap.
 */
function pushPoisFromStore(map: maplibregl.Map) {
  const state = useAppStore.getState();
  const src = map.getSource('pois') as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const all = [...state.candidates, ...state.annexCandidates];
  const feats = all.map(({ feature: f, distM, id }) => {
    const typeValeur = f.properties.type?.valeur;
    const iconImage = typeValeur ? `poi-${typeValeur}` : 'poi-default';
    return {
      ...f,
      properties: {
        ...f.properties,
        id,
        iconImage,
        selected: state.selectedIds.has(id),
        distM: Math.round(distM),
      },
    };
  });
  src.setData({ type: 'FeatureCollection', features: feats });
}

/**
 * Enregistre tous les markers SVG (cercle coloré + icône Lucide) comme images
 * MapLibre. Asynchrone à cause du Image() loader, retourne une Promise.
 */
async function registerAllMarkers(map: maplibregl.Map) {
  const images = await loadAllMarkerImages(48);
  for (const { id, image } of images) {
    if (map.hasImage(id)) continue;
    map.addImage(id, image, { pixelRatio: 2 });
  }
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

// ─── Zones pastorales (MapPatou) ──────────────────────────────────
// Couleurs sémantiques : violet = présence de chiens de protection (alerte
// forte pour le randonneur), ambre = zone pastorale standard.
const PASTORAL_DOG_FILL = '#7c3aed';
const PASTORAL_DOG_LINE = '#5b21b6';
const PASTORAL_FILL = '#f59e0b';
const PASTORAL_LINE = '#b45309';

// Dernière FeatureCollection pastorale affichée. Conservée au niveau module
// pour pouvoir la ré-appliquer après un `setStyle()` (qui vide les sources),
// au même titre que `pushTraceFromStore` / `pushPoisFromStore`.
let _lastPastoralData: FeatureCollection = EMPTY_FC;

function pushMapPatouFromStore(map: maplibregl.Map) {
  const src = map.getSource('mappatou') as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData(_lastPastoralData);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Contenu HTML du popup d'une UP. `surface` est volontairement ignoré
 * (chaîne non exploitable comme superficie, cf. mappatou-api). */
function buildPastoralPopup(raw: maplibregl.MapGeoJSONFeature['properties']): string {
  const p = (raw ?? {}) as MapPatouProperties;
  const nom = p.nom ? escapeHtml(String(p.nom)) : 'Unité pastorale';
  const hasDogs = p.chiens === true || (p.chiens as unknown) === 'true';
  const periode =
    p.debut && p.fin ? `${escapeHtml(String(p.debut))} → ${escapeHtml(String(p.fin))}` : 'n/c';
  const jours = escapeHtml(presentDaysSummary(p));
  const dogLine = hasDogs
    ? '<div style="margin-top:6px;padding:4px 6px;border-radius:4px;background:#f3e8ff;color:#6b21a8;font-weight:600;font-size:12px">⚠️ Chiens de protection (patous)</div>'
    : '<div style="margin-top:6px;font-size:12px;color:#64748b">Pas de chiens de protection signalés</div>';
  return (
    `<div style="font-family:inherit;font-size:12px;line-height:1.45;color:#1e293b">` +
    `<strong style="font-size:13px">${nom}</strong>` +
    `<div style="margin-top:4px;color:#475569">Troupeau : ${escapeHtml(animalLabel(p.type_animal))}</div>` +
    `<div style="color:#475569">Présence : ${periode}</div>` +
    `<div style="color:#475569">Jours : ${jours}</div>` +
    dogLine +
    `</div>`
  );
}

/**
 * Installe les sources/couches applicatives (`trace`, `pois`, halo) et déclenche
 * le chargement des markers SVG. À appeler à l'init **et** après chaque
 * `setStyle({ diff: false })` — MapLibre vide alors sources et couches.
 *
 * ⚠️ Ne pas attacher ici les handlers d'événements (`click`, `mouseenter`,
 * `mouseleave`) : ils sont liés à la map, pas au style, et survivent au swap.
 * Les ré-attacher ici les ferait s'accumuler à chaque changement de fond.
 */
function setupOverlays(map: maplibregl.Map, onMarkersReady: () => void) {
  // Zones pastorales en premier → rendues SOUS la trace et les markers POI.
  // `attribution` sur la source alimente le contrôle d'attribution MapLibre.
  // Gated : en prod (licence non confirmée) on n'ajoute ni source, ni couches,
  // ni attribution (cf. PASTORAL_FEATURE_ENABLED).
  if (PASTORAL_FEATURE_ENABLED) {
    map.addSource('mappatou', { type: 'geojson', data: _lastPastoralData, attribution: MAPPATOU_ATTRIBUTION });
    map.addLayer({
      id: 'mappatou-fill',
      type: 'fill',
      source: 'mappatou',
      paint: {
        'fill-color': ['case', ['==', ['get', 'chiens'], true], PASTORAL_DOG_FILL, PASTORAL_FILL],
        'fill-opacity': 0.28,
      },
    });
    map.addLayer({
      id: 'mappatou-line',
      type: 'line',
      source: 'mappatou',
      paint: {
        'line-color': ['case', ['==', ['get', 'chiens'], true], PASTORAL_DOG_LINE, PASTORAL_LINE],
        'line-width': 1.5,
      },
    });
  }

  map.addSource('trace', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'trace-buf',
    type: 'fill',
    source: 'trace',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#1e40af', 'fill-opacity': 0.08, 'fill-outline-color': '#1e40af' },
  });
  map.addLayer({
    id: 'trace-line',
    type: 'line',
    source: 'trace',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#1e40af', 'line-width': 4, 'line-opacity': 0.9 },
  });

  registerAllMarkers(map)
    .then(onMarkersReady)
    .catch((e) => console.error('markers load failed', e));

  map.addSource('pois', { type: 'geojson', data: EMPTY_FC });

  // Halo doré sous le marker des POIs sélectionnés
  map.addLayer({
    id: 'pois-halo',
    type: 'circle',
    source: 'pois',
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': 20,
      'circle-color': '#f5b800',
      'circle-opacity': 0.5,
      'circle-stroke-color': '#b85c38',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'pois',
    type: 'symbol',
    source: 'pois',
    layout: {
      'icon-image': ['get', 'iconImage'],
      'icon-size': ['case', ['get', 'selected'], 0.6, 0.5],
      'icon-allow-overlap': true,
      'icon-anchor': 'center',
    },
  });
}

export function MapView() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const initialized = React.useRef(false);
  // Les markers SVG sont chargés en async via Image() → si on essaie d'appliquer
  // les POIs sur la couche symbol avant que les images soient enregistrées,
  // MapLibre ne rend rien (l'icône reste invisible jusqu'à la prochaine
  // mise à jour de la source). On gate donc l'update sur ce flag.
  const [markersReady, setMarkersReady] = React.useState(false);

  const trace = useAppStore((s) => s.trace);
  const bufferStepIdx = useAppStore((s) => s.bufferStepIdx);
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const enabledAnnexTypes = useAppStore((s) => s.enabledAnnexTypes);
  const enabledDtGroups = useAppStore((s) => s.enabledDtGroups);
  const setCandidates = useAppStore((s) => s.setCandidates);
  const setAnnexCandidates = useAppStore((s) => s.setAnnexCandidates);
  const setLoading = useAppStore((s) => s.setLoading);
  const setAnnexLoading = useAppStore((s) => s.setAnnexLoading);
  const setApiError = useAppStore((s) => s.setApiError);
  const setAnnexError = useAppStore((s) => s.setAnnexError);
  const candidates = useAppStore((s) => s.candidates);
  const annexCandidates = useAppStore((s) => s.annexCandidates);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const openDetail = useAppStore((s) => s.openDetail);
  const basemap = useAppStore((s) => s.basemap);
  const pastoralEnabled = useAppStore((s) => s.pastoralEnabled);
  const pastoralDate = useAppStore((s) => s.pastoralDate);
  const pastoralOnlyDogs = useAppStore((s) => s.pastoralOnlyDogs);
  const setPastoralCount = useAppStore((s) => s.setPastoralCount);
  const setPastoralLoading = useAppStore((s) => s.setPastoralLoading);
  const setPastoralError = useAppStore((s) => s.setPastoralError);

  // Jeu MapPatou chargé pour une date donnée (l'API filtre la période côté
  // serveur). `date` étiquette le contenu pour distinguer données fraîches /
  // périmées après un changement de date. `bboxes` pré-calculées pour le
  // pré-filtrage rapide. `pastoralVersion` déclenche le recalcul du rendu
  // après chaque fetch.
  const pastoralRawRef = React.useRef<{
    date: string;
    features: MapPatouFeature[];
    bboxes: [number, number, number, number][];
  } | null>(null);
  const [pastoralVersion, setPastoralVersion] = React.useState(0);

  // Évite un swap inutile au tout premier rendu : la map est déjà initialisée
  // avec le style courant du store.
  const isFirstBasemapRun = React.useRef(true);

  // ─── Init map ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    // Lecture one-shot via getState : on ne veut pas que ce useEffect dépende
    // de `basemap` (ce qui re-créerait la map à chaque swap).
    const initialBasemap = useAppStore.getState().basemap;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAPS[initialBasemap].style,
      center: [2.5, 46.5],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Handlers attachés une seule fois — ils ciblent le layer `pois` par id,
    // donc ils continuent de fonctionner après chaque `setStyle` qui ré-ajoute
    // le layer avec le même id.
    map.on('click', 'pois', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = Number(f.properties?.id);
      if (!isNaN(id)) openDetail(id);
    });
    map.on('mouseenter', 'pois', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'pois', () => (map.getCanvas().style.cursor = ''));

    // Popup d'une zone pastorale (gated avec la couche, cf. PASTORAL_FEATURE_ENABLED).
    if (PASTORAL_FEATURE_ENABLED) {
      map.on('click', 'mappatou-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(buildPastoralPopup(f.properties))
          .addTo(map);
      });
      map.on('mouseenter', 'mappatou-fill', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'mappatou-fill', () => (map.getCanvas().style.cursor = ''));
    }

    map.on('load', () => {
      setupOverlays(map, () => setMarkersReady(true));
    });

    mapRef.current = map;
    // expose for tests/debug
    (window as unknown as { __map?: maplibregl.Map }).__map = map;

    // S'assurer que le canvas prend la taille de son container,
    // même si celui-ci n'avait pas encore ses dimensions au mount.
    const resize = () => map.resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);
    window.addEventListener('resize', resize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
      map.remove();
      mapRef.current = null;
      initialized.current = false;
    };
  }, [openDetail]);

  // ─── Swap basemap ───────────────────────────────────────────────
  // `diff: false` force un reset complet du style — sinon nos sources/layers
  // imperatifs (trace, pois) interfèrent avec le diff.
  //
  // ⚠️ Piège : `'styledata'` fire AVANT que le style soit prêt
  // (`isStyleLoaded() === false` à ce moment). On utilise `'style.load'` qui
  // existe en MapLibre mais n'est pas dans le typedef (cf STYLE_LOAD_EVENT).
  //
  // On pousse la trace directement plutôt que de bumper un état React :
  // les effets trace/POI sont gatés sur `isStyleLoaded` avec un fallback
  // `map.once('load', ...)` qui ne refire pas après setStyle.
  React.useEffect(() => {
    if (isFirstBasemapRun.current) {
      isFirstBasemapRun.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    setMarkersReady(false);
    map.setStyle(BASEMAPS[basemap].style, { diff: false });
    map.once(STYLE_LOAD_EVENT, () => {
      setupOverlays(map, () => {
        // markersReady passe à true → l'effet POI re-fire normalement pour
        // les futurs changements ; mais on pousse aussi en direct juste
        // après le ré-enregistrement des icônes, car React 18 peut batcher
        // le toggle false→true au point que l'effet ne se re-déclenche pas.
        setMarkersReady(true);
        pushPoisFromStore(map);
      });
      pushTraceFromStore(map);
      pushMapPatouFromStore(map);
    });
  }, [basemap]);

  // ─── Render trace + buffer ──────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('trace') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!trace) {
        src.setData(EMPTY_FC);
        return;
      }
      const line = traceToLine(trace);
      const buffer = bufferLine(line, BUFFER_STEPS[bufferStepIdx]?.meters ?? 500);
      src.setData({
        type: 'FeatureCollection',
        features: [line, buffer],
      });
      const bb = traceBbox(trace);
      map.fitBounds([
        [bb[0], bb[1]],
        [bb[2], bb[3]],
      ], { padding: 80, duration: 600 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [trace, bufferStepIdx]);

  // ─── Fetch POIs + filtre par distance ───────────────────────────
  React.useEffect(() => {
    if (!trace) {
      setCandidates([]);
      return;
    }
    const types = Array.from(enabledTypes)
      .map((k: TypeKey) => TYPE_LABELS[k].valeurAPI.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, ''))
      .join(',');
    if (!types) {
      setCandidates([]);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setApiError(null);

    const bufferM = BUFFER_STEPS[bufferStepIdx]?.meters ?? 500;
    const bbox = expandBboxMeters(traceBbox(trace), bufferM);
    const line = traceToLine(trace);

    // type_points accepte: refuge, cabane, gite, pt_eau, pt_passage
    const typesCsv = Array.from(enabledTypes).join(',');

    fetchPOIsInBbox(bbox, typesCsv, ctrl.signal)
      .then((pois) => {
        const candidates = filterByDistance(line, pois, bufferM, 'refuges');
        setCandidates(candidates);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setApiError(e instanceof Error ? e.message : 'Erreur API');
          setCandidates([]);
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [trace, bufferStepIdx, enabledTypes, setCandidates, setLoading, setApiError]);

  // ─── Fetch sources annexes (Overpass + Camptocamp) ──────────────
  React.useEffect(() => {
    if (!trace || enabledAnnexTypes.size === 0) {
      setAnnexCandidates([]);
      setAnnexError(null);
      return;
    }
    const ctrl = new AbortController();
    setAnnexLoading(true);
    setAnnexError(null);

    const bufferM = BUFFER_STEPS[bufferStepIdx]?.meters ?? 500;
    const bbox = expandBboxMeters(traceBbox(trace), bufferM);
    const line = traceToLine(trace);

    const wantWater = enabledAnnexTypes.has('osm_water' as TypeKey);
    const wantBivouac = enabledAnnexTypes.has('c2c_bivouac' as TypeKey);
    const wantShop = enabledAnnexTypes.has('osm_shop' as TypeKey);
    const wantGare = enabledAnnexTypes.has('sncf_gare' as TypeKey);
    const wantLodging = enabledAnnexTypes.has('dt_lodging' as TypeKey);
    const wantArret = enabledAnnexTypes.has('pan_arret' as TypeKey);
    const wantPharmacy = enabledAnnexTypes.has('osm_pharmacy' as TypeKey);
    const wantAtm = enabledAnnexTypes.has('osm_atm' as TypeKey);
    const wantToilets = enabledAnnexTypes.has('osm_toilets' as TypeKey);
    const wantAmenities = wantPharmacy || wantAtm || wantToilets;

    const tasks: Promise<PoiCandidate[]>[] = [];
    if (wantWater) {
      tasks.push(
        fetchWaterPointsOSM(bbox, ctrl.signal).then((pois) =>
          filterByDistance(line, pois, bufferM, 'osm'),
        ),
      );
    }
    if (wantBivouac) {
      tasks.push(
        fetchBivouacsC2C(bbox, ctrl.signal).then((pois) =>
          filterByDistance(line, pois, bufferM, 'c2c'),
        ),
      );
    }
    if (wantShop) {
      tasks.push(
        fetchShopsOSM(bbox, ctrl.signal).then((pois) =>
          filterByDistance(line, pois, bufferM, 'osm'),
        ),
      );
    }
    if (wantAmenities) {
      // Une seule requête Overpass pour pharmacies / ATM / toilettes ; le filtre
      // par sous-catégorie (l'utilisateur peut n'avoir activé que les pharmacies)
      // se fait après réception, sur la valeur `type.valeur` portée par chaque
      // feature. Évite trois aller-retours Overpass pour gagner deux secondes
      // de fetch quand les trois sont activés.
      tasks.push(
        fetchAmenitiesOSM(bbox, ctrl.signal).then((pois) => {
          const filtered = pois.filter((f) => {
            const v = f.properties.type?.valeur;
            if (v === 'osm_pharmacy') return wantPharmacy;
            if (v === 'osm_atm') return wantAtm;
            if (v === 'osm_toilets') return wantToilets;
            return false;
          });
          return filterByDistance(line, filtered, bufferM, 'osm');
        }),
      );
    }
    if (wantGare || wantArret) {
      // Buffer plus généreux pour les sources transport : un randonneur cherche
      // surtout un point d'accès au début et à la fin du tracé, parfois à
      // plusieurs kilomètres. Plancher à 3 km pour rester utile même avec un
      // buffer d'analyse principal très resserré (100-500 m).
      const transportBufferM = Math.max(bufferM, 3000);
      const transportBbox = expandBboxMeters(traceBbox(trace), transportBufferM);
      if (wantGare) {
        tasks.push(
          fetchGaresSNCF(transportBbox, ctrl.signal).then((pois) =>
            filterByDistance(line, pois, transportBufferM, 'sncf'),
          ),
        );
      }
      if (wantArret) {
        tasks.push(
          fetchArretsPAN(transportBbox, ctrl.signal).then((pois) =>
            filterByDistance(line, pois, transportBufferM, 'pan'),
          ),
        );
      }
    }
    if (wantLodging) {
      // Buffer standard du slider — l'idée est de pouvoir trouver un hébergement
      // de repli à n'importe quel endroit de la trace (court-circuit, bail-out
      // en cas de météo qui tourne, blessure, étape qui s'allonge…).
      //
      // Filtre par sous-groupe DT (Refuges privés / Gîtes / Hôtels / etc.) :
      // on construit le set des URIs ontologiques autorisées à partir des
      // groupes activés dans le store. Si aucun groupe n'est activé, on saute
      // carrément le fetch (l'utilisateur a tout décoché manuellement).
      const allowedSubtypes = new Set<string>();
      for (const g of enabledDtGroups) {
        const meta = DT_GROUPS[g];
        if (meta) for (const sub of meta.subtypes) allowedSubtypes.add(sub);
      }
      if (allowedSubtypes.size > 0) {
        tasks.push(
          fetchDatatourismeLodging(bbox, ctrl.signal).then((pois) => {
            const filtered = pois.filter((f) => {
              const sub = (f.properties as { dtSubtype?: string }).dtSubtype;
              return sub ? allowedSubtypes.has(sub) : false;
            });
            return filterByDistance(line, filtered, bufferM, 'datatourisme');
          }),
        );
      }
    }

    Promise.all(tasks)
      .then((results) => {
        const merged = results.flat();
        merged.sort((a, b) => a.distM - b.distM);
        setAnnexCandidates(merged);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          setAnnexError(e instanceof Error ? e.message : 'Erreur source annexe');
          setAnnexCandidates([]);
        }
      })
      .finally(() => setAnnexLoading(false));

    return () => ctrl.abort();
  }, [
    trace,
    bufferStepIdx,
    enabledAnnexTypes,
    enabledDtGroups,
    setAnnexCandidates,
    setAnnexLoading,
    setAnnexError,
  ]);

  // ─── Fetch MapPatou (par date — l'API filtre la période d'estive) ─
  // Fetch à l'activation de la couche + en présence d'une trace, puis à chaque
  // changement de date. Mémo module + cache IndexedDB (clé = date) → re-sélection
  // d'une date déjà vue instantanée.
  React.useEffect(() => {
    if (!PASTORAL_FEATURE_ENABLED || !pastoralEnabled || !trace) return;
    const date = pastoralDate;
    // Déjà en mémoire pour cette date → forcer un recalcul du rendu.
    if (pastoralRawRef.current?.date === date) {
      setPastoralVersion((v) => v + 1);
      return;
    }
    const ctrl = new AbortController();
    setPastoralLoading(true);
    setPastoralError(null);
    fetchMapPatou(date, ctrl.signal)
      .then((fc) => {
        const features = (fc.features ?? []) as MapPatouFeature[];
        // bbox par feature : pré-filtre numérique rapide avant le test
        // d'intersection géométrique (coûteux).
        const bboxes = features.map(
          (f) => turf.bbox(f) as [number, number, number, number],
        );
        pastoralRawRef.current = { date, features, bboxes };
        setPastoralVersion((v) => v + 1);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          setPastoralError(e instanceof Error ? e.message : 'Erreur zones pastorales');
        }
      })
      .finally(() => setPastoralLoading(false));
    return () => ctrl.abort();
  }, [pastoralEnabled, trace, pastoralDate, setPastoralLoading, setPastoralError]);

  // ─── Filtre + rendu de la couche pastorale ──────────────────────
  // Pré-filtre bbox numérique (rapide sur ~5000 UP) → date/chiens →
  // intersection géométrique précise avec le buffer du tracé.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('mappatou') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const raw = pastoralRawRef.current;
    // On n'affiche que si les données en mémoire correspondent à la date courante
    // (sinon : couche off, pas de trace, ou fetch d'une nouvelle date en cours).
    if (!pastoralEnabled || !trace || !raw || raw.date !== pastoralDate) {
      _lastPastoralData = EMPTY_FC;
      src.setData(EMPTY_FC);
      setPastoralCount(0);
      return;
    }

    const bufferM = BUFFER_STEPS[bufferStepIdx]?.meters ?? 500;
    const tb = expandBboxMeters(traceBbox(trace), bufferM);
    const buffer = bufferLine(traceToLine(trace), bufferM);
    const { features, bboxes } = raw;

    const out: MapPatouFeature[] = [];
    for (let i = 0; i < features.length; i++) {
      const b = bboxes[i];
      if (!b) continue;
      // Pré-filtre bbox : rejette tout ce qui ne chevauche pas la bbox du tracé.
      if (b[2] < tb[0] || b[0] > tb[2] || b[3] < tb[1] || b[1] > tb[3]) continue;
      const f = features[i];
      if (!f) continue;
      const p = f.properties;
      if (pastoralOnlyDogs && p.chiens !== true) continue;
      if (!isUpActiveOn(p, pastoralDate)) continue;
      // Test géométrique précis en dernier (sur le petit reliquat post-bbox).
      if (!turf.booleanIntersects(f, buffer)) continue;
      out.push(f);
    }

    const fc: FeatureCollection = { type: 'FeatureCollection', features: out };
    _lastPastoralData = fc;
    src.setData(fc);
    setPastoralCount(out.length);
    map.triggerRepaint();
  }, [
    pastoralEnabled,
    pastoralVersion,
    pastoralDate,
    pastoralOnlyDogs,
    trace,
    bufferStepIdx,
    setPastoralCount,
  ]);

  // ─── Update POIs layer ──────────────────────────────────────────
  // Gate sur markersReady : on évite de pousser les features avant que les
  // images soient enregistrées, sinon MapLibre rend l'icône comme manquante
  // (point invisible). Une fois markersReady true, l'effect re-fire avec les
  // candidates actuels et tout s'affiche correctement.
  React.useEffect(() => {
    if (!markersReady) return;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('pois') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      // Filtre local par ID de type (au lieu du libellé string) : c'est
      // immune aux subtilités d'encodage Unicode (NFC vs NFD), aux espaces
      // insécables et aux variations de casse qui peuvent arriver dans les
      // réponses API. Chaque TypeMeta porte un id numérique stable.
      const enabledIds = new Set<number>();
      for (const k of enabledTypes) enabledIds.add(TYPE_LABELS[k].id);
      for (const k of enabledAnnexTypes) enabledIds.add(TYPE_LABELS[k].id);
      const all = [...candidates, ...annexCandidates].filter(({ feature: f }) => {
        const tid = f.properties.type?.id;
        return typeof tid === 'number' && enabledIds.has(tid);
      });
      const feats = all.map(({ feature: f, distM, id }) => {
        const typeValeur = f.properties.type?.valeur;
        const iconImage = typeValeur ? `poi-${typeValeur}` : 'poi-default';
        // Force l'id GeoJSON top-level (et pas seulement dans properties).
        // MapLibre fait du diffing sur ce champ pour identifier les features
        // qui doivent disparaître entre deux setData ; quand il est manquant,
        // les markers anciens peuvent persister à l'écran de façon erratique.
        // refuges.info ne le renseigne pas toujours, donc on s'en charge ici.
        return {
          ...f,
          id,
          properties: {
            ...f.properties,
            id,
            iconImage,
            selected: selectedIds.has(id),
            distM: Math.round(distM),
          },
        };
      });
      src.setData({ type: 'FeatureCollection', features: feats });
      // Force un repaint immédiat. setData met à jour la source mais MapLibre
      // peut différer le rendu jusqu'au prochain événement utilisateur (zoom,
      // pan, click). On évite ainsi le décalage d'une frame entre la donnée
      // et l'affichage qui rendait l'app "inversée" au toggle d'un filtre.
      map.triggerRepaint();
    };
    // On appelle apply() systématiquement sans gating sur `isStyleLoaded()`.
    // `setData()` fonctionne quel que soit l'état du style — MapLibre re-tile
    // automatiquement. L'ancien fallback `map.once('load', apply)` était un
    // piège : `'load'` ne fire qu'une seule fois au tout début et jamais
    // après, donc si le style était transitoirement "non chargé" (au milieu
    // d'un rebuild de tuiles déclenché par un précédent setData), l'update
    // était silencieusement perdu. Bug visible quand un toggle de filtre se
    // chaînait à un fetch très rapide (cache IndexedDB) : le 2e setData avec
    // la nouvelle donnée tombait dans la fenêtre où `isStyleLoaded()===false`.
    apply();
  }, [
    candidates,
    annexCandidates,
    selectedIds,
    markersReady,
    enabledTypes,
    enabledAnnexTypes,
  ]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      <BasemapSwitcher />
    </div>
  );
}

function BasemapSwitcher() {
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);
  return (
    <div
      role="radiogroup"
      aria-label="Fond de carte"
      className="absolute top-2.5 right-2.5 z-10 flex gap-0.5 rounded-md border border-slate-200 bg-white/95 p-0.5 shadow-md backdrop-blur"
    >
      {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => {
        const active = basemap === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setBasemap(id)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors select-none',
              active
                ? 'bg-[var(--color-ink)] text-white'
                : 'text-[var(--color-ink-mute)] hover:bg-slate-100 hover:text-[var(--color-ink)]',
            )}
          >
            {BASEMAP_SHORT_LABEL[id]}
          </button>
        );
      })}
    </div>
  );
}
