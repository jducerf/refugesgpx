import type { ParsedGpx, PoiCandidate } from './types';
import { getTypeMeta } from './types';

const TYPE_PREFIX: Record<string, string> = {
  'refuge gardé': '[Refuge]',
  'cabane non gardée': '[Cabane]',
  "gîte d'étape": '[Gîte]',
  "point d'eau": '[Eau]',
  'passage délicat': '[Passage]',
  osm_water: '[Eau OSM]',
  c2c_bivouac: '[Bivouac C2C]',
  osm_shop: '[Ravitaillement]',
  sncf_gare: '[Gare]',
  dt_lodging: '[Hébergement]',
  osm_pharmacy: '[Pharmacie]',
  osm_atm: '[Distributeur]',
  osm_toilets: '[Toilettes]',
};

/** Libellé long FR par valeur OSM, pour la `<desc>` GPX (toutes les sources
 * `osm` partagent la même branche dans le switch typeLabel ci-dessous). */
const OSM_TYPE_LABEL: Record<string, string> = {
  osm_water: 'eau OSM',
  osm_shop: 'commerce OSM',
  osm_pharmacy: 'pharmacie OSM',
  osm_atm: 'distributeur OSM',
  osm_toilets: 'toilettes OSM',
};

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
    }
    return c;
  });
}

export function buildEnrichedGpx(
  trace: ParsedGpx,
  selectedPois: PoiCandidate[],
): string {
  const trkpts = trace.points
    .map((p) => {
      const ele = p.ele !== undefined ? `<ele>${p.ele}</ele>` : '';
      return `      <trkpt lat="${p.lat}" lon="${p.lon}">${ele}</trkpt>`;
    })
    .join('\n');

  const wpts = selectedPois
    .map(({ feature: f, distM, source }) => {
      const props = f.properties as Record<string, unknown> & {
        nom: string;
        type?: { valeur: string };
        coord?: { alt?: number };
        lien?: string;
        osmSubtype?: string;
      };
      const typeValeur = props.type?.valeur ?? '';
      const prefix = TYPE_PREFIX[typeValeur];
      const name = prefix ? `${prefix} ${props.nom}` : props.nom;
      const alt = props.coord?.alt;
      // appel pour conserver l'import et permettre des extensions futures
      void getTypeMeta(typeValeur);
      const ele = alt !== undefined ? `<ele>${alt}</ele>` : '';
      const link = props.lien ? `<link href="${xmlEscape(props.lien)}"/>` : '';
      const osmBase = OSM_TYPE_LABEL[typeValeur] ?? 'point OSM';
      const typeLabel =
        source === 'osm'
          ? `${osmBase}${props.osmSubtype ? ` (${props.osmSubtype})` : ''}`
          : source === 'c2c'
            ? 'bivouac (Camptocamp)'
            : source === 'sncf'
              ? 'gare SNCF'
              : source === 'datatourisme'
                ? `hébergement (DATAtourisme)`
                : typeValeur;
      const desc = `${typeLabel}${
        alt !== undefined ? ' · ' + alt + ' m' : ''
      } · ${Math.round(distM)} m du tracé`;
      return `  <wpt lat="${f.geometry.coordinates[1]}" lon="${f.geometry.coordinates[0]}">
    ${ele}
    <name>${xmlEscape(name)}</name>
    <desc>${xmlEscape(desc)}</desc>
    <type>${xmlEscape(typeValeur)}</type>
    ${link}
  </wpt>`;
    })
    .join('\n');

  const usedSources = new Set(selectedPois.map((p) => p.source));
  const labels: string[] = [];
  if (usedSources.has('refuges')) labels.push('refuges.info (CC BY-SA 2.0)');
  if (usedSources.has('osm')) labels.push('OpenStreetMap (ODbL)');
  if (usedSources.has('c2c')) labels.push('Camptocamp (CC BY-SA)');
  if (usedSources.has('sncf')) labels.push('SNCF — Gares de voyageurs (LOV2)');
  if (usedSources.has('datatourisme'))
    labels.push('DATAtourisme / ADN Tourisme (Licence Ouverte)');
  const sourcesLabel = labels.length > 0 ? labels.join(' + ') : 'refuges.info (CC BY-SA 2.0)';
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="refugesgpx" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xmlEscape(trace.name)} (enrichi)</name>
    <desc>Tracé enrichi de ${selectedPois.length} POI(s) — ${sourcesLabel}</desc>
    <copyright author="${xmlEscape(sourcesLabel)}">
      <license>https://creativecommons.org/licenses/by-sa/2.0/</license>
    </copyright>
  </metadata>
${wpts}
  <trk>
    <name>${xmlEscape(trace.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
