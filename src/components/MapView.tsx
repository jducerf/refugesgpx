import * as React from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { useAppStore } from '@/store/useAppStore';
import {
  bufferLine,
  expandBboxMeters,
  filterByDistance,
  traceBbox,
  traceToLine,
} from '@/lib/geo';
import { fetchPOIsInBbox } from '@/lib/refuges-api';
import { BUFFER_STEPS, TYPE_LABELS, type TypeKey } from '@/lib/types';
import { loadAllMarkerImages } from '@/lib/markers';

// OSM standard : ouvert, très tolérant, attribution standard.
// On évite délibérément de déclarer `glyphs` : les couches POI utilisent des
// icon-image pré-rendues (pas de text-field), donc aucun PBF n'est nécessaire.
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8f0e3' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
} as unknown as maplibregl.StyleSpecification;

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

export function MapView() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const initialized = React.useRef(false);

  const trace = useAppStore((s) => s.trace);
  const bufferStepIdx = useAppStore((s) => s.bufferStepIdx);
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const setCandidates = useAppStore((s) => s.setCandidates);
  const setLoading = useAppStore((s) => s.setLoading);
  const setApiError = useAppStore((s) => s.setApiError);
  const candidates = useAppStore((s) => s.candidates);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const openDetail = useAppStore((s) => s.openDetail);

  // ─── Init map ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [2.5, 46.5],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
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

      // Markers SVG (cercle coloré + icône Lucide) — chargement asynchrone
      registerAllMarkers(map).catch((e) => console.error('markers load failed', e));

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

      map.on('click', 'pois', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = Number(f.properties?.id);
        if (!isNaN(id)) openDetail(id);
      });
      map.on('mouseenter', 'pois', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'pois', () => (map.getCanvas().style.cursor = ''));
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
        const candidates = filterByDistance(line, pois, bufferM);
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

  // ─── Update POIs layer ──────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('pois') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const feats = candidates.map(({ feature: f, distM, id }) => {
        const typeValeur = f.properties.type?.valeur;
        const iconImage = typeValeur ? `poi-${typeValeur}` : 'poi-default';
        return {
          ...f,
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
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [candidates, selectedIds]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
