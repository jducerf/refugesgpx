import type { TypeMeta } from './types';
import { TYPE_LABELS } from './types';

/**
 * Génère un SVG inline (cercle de fond + path Lucide blanc) prêt à être
 * rasterisé en image bitmap pour MapLibre.
 */
export function buildMarkerSvg(meta: TypeMeta, size = 48, ring = 2.5): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
    <circle cx="24" cy="24" r="${22 - ring / 2}" fill="${meta.color}" stroke="#1A1A1A" stroke-width="${ring}"/>
    <g transform="translate(12 12)" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      ${meta.svgPath}
    </g>
  </svg>`;
}

/** Marker générique pour les types inconnus (cercle gris foncé + point). */
export function buildDefaultMarkerSvg(size = 48): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
    <circle cx="24" cy="24" r="20" fill="#6b6760" stroke="#1A1A1A" stroke-width="2.5"/>
    <circle cx="24" cy="24" r="4" fill="white"/>
  </svg>`;
}

/**
 * Charge un SVG string comme image bitmap (asynchrone via Image()).
 */
export function svgToImageBitmap(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** Couple `[id MapLibre, image]` à enregistrer via map.addImage. */
export type MarkerImage = { id: string; image: HTMLImageElement };

export async function loadAllMarkerImages(size = 48): Promise<MarkerImage[]> {
  const promises: Promise<MarkerImage>[] = [];
  for (const meta of Object.values(TYPE_LABELS)) {
    const id = `poi-${meta.valeurAPI}`;
    promises.push(
      svgToImageBitmap(buildMarkerSvg(meta, size)).then((image) => ({ id, image })),
    );
  }
  promises.push(
    svgToImageBitmap(buildDefaultMarkerSvg(size)).then((image) => ({
      id: 'poi-default',
      image,
    })),
  );
  return Promise.all(promises);
}
