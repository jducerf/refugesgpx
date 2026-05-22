/**
 * Proxy de l'API Vigilance Météo-France.
 *
 * Pourquoi un proxy : l'endpoint officiel
 * (public-api.meteofrance.fr/public/DPVigilance) exige une clé d'application
 * qu'on ne peut pas exposer dans un bundle client. Cette fonction tient la clé
 * côté serveur (variable d'env Netlify METEO_FRANCE_API_KEY) et relaie la
 * réponse.
 *
 * Cache :
 *  - Module scope (cold-start partagé entre invocations chaudes) : 30 min.
 *    La vigilance n'est mise à jour que ~2×/jour par Météo-France.
 *  - `Cache-Control: s-maxage` 1800 s pour le CDN Netlify, `max-age` 600 s
 *    pour le navigateur. La grande majorité des requêtes utilisateurs ne
 *    touchent donc jamais la fonction elle-même.
 */

const UPSTREAM_URL =
  'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const CDN_TTL_S = 1800;
const BROWSER_TTL_S = 600;

interface CacheEntry {
  ts: number;
  body: string;
}

let memCache: CacheEntry | null = null;

export default async (_req: Request): Promise<Response> => {
  const apiKey = process.env.METEO_FRANCE_API_KEY;
  if (!apiKey) {
    return jsonError(503, 'METEO_FRANCE_API_KEY non configurée côté Netlify.');
  }

  if (memCache && Date.now() - memCache.ts < CACHE_TTL_MS) {
    return jsonOk(memCache.body, true);
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      headers: {
        accept: '*/*',
        apikey: apiKey,
      },
    });
  } catch (e) {
    return jsonError(502, `Météo-France injoignable: ${(e as Error).message}`);
  }

  if (!upstream.ok) {
    // Si on a un cache même expiré, on préfère le servir plutôt que de
    // remonter une erreur — les bulletins changent peu, mieux vaut un état
    // un peu daté qu'un panneau vide.
    if (memCache) return jsonOk(memCache.body, true);
    const detail = await upstream.text().catch(() => '');
    return jsonError(
      upstream.status,
      `Météo-France a répondu ${upstream.status}: ${detail.slice(0, 200)}`,
    );
  }

  const body = await upstream.text();
  memCache = { ts: Date.now(), body };
  return jsonOk(body, false);
};

function jsonOk(body: string, stale: boolean): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${BROWSER_TTL_S}, s-maxage=${CDN_TTL_S}`,
      'x-cache': stale ? 'HIT' : 'MISS',
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
