# 🥾 Refuges.GPX

> Web-app qui prend un GPX existant, affiche tout ce qui compte autour du tracé — refuges, cabanes, gîtes, points d'eau, bivouacs, ravitaillement, transports, vigilance météo — et exporte un **GPX enrichi** + un **topo PDF** imprimable.

🚀 **En ligne** : **[refuges.yoandev.co](https://refuges.yoandev.co)**

[![Licence MIT](https://img.shields.io/badge/Licence-MIT-1A1A1A.svg)](./LICENSE)
[![Données CC BY-SA 2.0](https://img.shields.io/badge/Donn%C3%A9es-CC%20BY--SA%202.0-B85C38.svg)](https://creativecommons.org/licenses/by-sa/2.0/)
[![Astro](https://img.shields.io/badge/Astro-6-orange.svg)](https://astro.build)
[![Sans backend](https://img.shields.io/badge/Sans-backend-5E6F4A.svg)](#stack)

---

## Pourquoi ?

Les planificateurs grand public (OpenRunner, Komoot, Visorando) ne savent pas afficher les cabanes non gardées, points d'eau et passages délicats — pourtant essentiels pour les randonneuses et randonneurs autonomes en bivouac.

Cette app **complète** ces outils : tu traces ton parcours là où tu as l'habitude, tu déposes le GPX ici, tu coches les refuges qui t'intéressent (avec accès aux derniers commentaires + photos terrain), et tu repars avec un GPX enrichi prêt à charger dans Komoot/OsmAnd/Gaia/GPS dédié.

## Fonctionnalités

- 📂 Import GPX (drag-and-drop ou fichier)
- 📏 Distance paramétrable autour du tracé (100 m à 5 km)
- 🧭 Filtres organisés en **5 besoins** : Dormir, Boire, Service, Transport, Attention — déployables source par source
- 🏷️ Sources couvertes :
  - **refuges.info** : refuges gardés, cabanes non gardées, gîtes d'étape, points d'eau, passages délicats
  - **Camptocamp** : bivouacs
  - **OpenStreetMap** (Overpass) : sources / eau, ravitaillement, pharmacies, distributeurs, toilettes publiques
  - **DATAtourisme** : hébergements (refuges privés, gîtes, B&B, auberges, campings, hôtels…)
  - **SNCF** + **transport.data.gouv.fr (PAN)** : gares et arrêts bus / cars
- 🗺️ Carte interactive (OpenStreetMap) avec POIs identifiés par icônes typées
- 📋 Liste latérale triée par distance au tracé
- 📖 Fiche détaillée par POI : équipements, accès, **5 derniers commentaires + photos** (refuges.info)
- ⛅ Panel **Météo** : prévisions Open-Meteo (départ / milieu / arrivée) + niveau de **Vigilance Météo-France** des départements traversés
- ✅ Sélection multiple
- 📥 **Export GPX enrichi** : tracé original intact + waypoints sélectionnés, avec `<copyright>` listant uniquement les sources réellement utilisées
- 🖨️ **Export topo PDF imprimable** : carte miniature + détails + commentaires (utilisable offline sur téléphone)

## Stack

- [Astro 6](https://astro.build) (SSG)
- [React 19](https://react.dev) (islands)
- [TypeScript 6](https://www.typescriptlang.org)
- [Tailwind CSS 4](https://tailwindcss.com)
- [MapLibre GL JS 5](https://maplibre.org) + tuiles [OpenStreetMap](https://www.openstreetmap.org)
- [Turf.js 7](https://turfjs.org) — calculs géo
- [Zod 4](https://zod.dev) — validation runtime des réponses API
- [Zustand 5](https://zustand-demo.pmnd.rs) — state management
- [Radix UI](https://www.radix-ui.com) — primitives accessibles

**Quasi-aucun backend.** Tout tourne dans le navigateur, les requêtes vont directement aux APIs publiques (refuges.info, Overpass / OSM, Camptocamp, DATAtourisme, SNCF, transport.data.gouv.fr, Open-Meteo). Seule exception : une mini Netlify Function (`netlify/functions/vigilance.ts`) qui relaie l'API Vigilance Météo-France — l'endpoint officiel exige une clé d'application qu'on ne peut pas exposer dans un bundle client (voir [Configuration Météo-France](#configuration-météo-france-optionnel)).

## Développement

```bash
git clone https://github.com/yoanbernabeu/refugesgpx
cd refugesgpx
npm install
npm run dev
```

Puis ouvre [http://localhost:4321](http://localhost:4321).

### Scripts

| Commande | Action |
|---|---|
| `npm run dev` | Serveur de développement Astro |
| `npm run build` | Build statique dans `dist/` |
| `npm run preview` | Preview du build |
| `npm run check` | Vérification TypeScript + Astro |
| `npm run test` | Tests Vitest |
| `npm run format` | Format Prettier |

## Déploiement

L'app est conçue pour [Netlify](https://www.netlify.com) (free tier suffit).
Le fichier [`netlify.toml`](./netlify.toml) configure tout ; un `git push` sur `main` suffit pour déployer.

L'app étant un site statique, elle peut tout aussi bien être servie via Cloudflare Pages, GitHub Pages, Vercel ou n'importe quel hébergeur de fichiers statiques. La section **Météo / Vigilance** nécessite en revanche une plateforme qui exécute les Netlify Functions (ou un équivalent serverless si tu portes le proxy).

## Configuration Météo-France (optionnel)

La section « Météo » se compose de deux blocs :

- **Prévisions Open-Meteo** (départ / milieu / arrivée du tracé) — gratuit, sans clé, actif d'office.
- **Vigilance Météo-France** des départements traversés — nécessite une clé d'application. Sans clé, ce bloc reste invisible ; les prévisions Open-Meteo continuent de s'afficher et le reste de l'app fonctionne normalement.

Pour l'activer :

1. Créer un compte sur [portail-api.meteofrance.fr](https://portail-api.meteofrance.fr).
2. S'abonner à l'API **« Données Publiques Vigilance »** (gratuit).
3. Générer une **clé d'application** (« application token »).
4. La déclarer dans les variables d'environnement Netlify sous le nom `METEO_FRANCE_API_KEY` :
   - Site settings → Build & deploy → Environment → Environment variables.
5. Redéployer.

La fonction proxy (`netlify/functions/vigilance.ts`) met le résultat en cache 30 min côté mémoire + 30 min côté CDN Netlify : un site très fréquenté n'appellera Météo-France que ~50 fois par jour, largement dans le free tier des Netlify Functions (125 k invocations / mois).

### Tester la Vigilance en local

`npm run dev` lance Astro seul — les Netlify Functions ne sont **pas** servies, donc le bloc Vigilance reste invisible. Pour le tester de bout en bout :

1. Installer la CLI Netlify : `npm i -g netlify-cli` (ou `npx netlify-cli`).
2. Créer un fichier `.env` à la racine du projet (déjà ignoré par git) :

   ```bash
   METEO_FRANCE_API_KEY=ta_cle_dapplication_meteo_france
   ```

3. Lancer `netlify dev` à la place de `npm run dev`. La CLI démarre Astro **et** les fonctions, charge automatiquement le `.env`, et expose le proxy sur `/.netlify/functions/vigilance`.

Alternative sans `.env` : `METEO_FRANCE_API_KEY=… netlify dev` (variable inline).

Si la variable est absente ou invalide, la fonction renvoie 503 et le composant Météo masque silencieusement le bloc Vigilance — pratique pour vérifier le fallback.

## Fond de carte — stratégie pérennité

Par défaut, l'app utilise les **tuiles standard d'OpenStreetMap** (`tile.openstreetmap.org`) — gratuites, libres, sans clé. Politique d'usage : ["moderate use" tolérée](https://operations.osmfoundation.org/policies/tiles/) (quelques milliers de requêtes par jour, OK pour le free tier Netlify).

Si l'audience grandit, le style de carte est isolé dans [`src/components/MapView.tsx`](./src/components/MapView.tsx) (constante `OSM_STYLE`) et basculable en quelques lignes vers un provider tiers gratuit avec inscription :

| Provider | Free tier | Atouts pour la rando |
|---|---|---|
| **[MapTiler](https://www.maptiler.com)** | 100 k tuiles + 25 k chargements / mois | Style « Outdoor » + courbes de niveau, gros catalogue |
| **[Stadia Maps](https://stadiamaps.com)** | 200 k tuiles / mois | Stamen Terrain, fonds rétro |
| **[Thunderforest](https://www.thunderforest.com)** | 150 k tuiles / mois | OpenCycleMap, Outdoors, OpenTopoMap stable |
| **[Géoportail IGN](https://geoservices.ign.fr)** | gratuit (clé obligatoire) | Scan25 — la référence rando en France |

Chacun fonctionne avec MapLibre via un simple changement d'URL de tuiles + ajout de clé.

## Données & licences

- **Code** : [MIT](./LICENSE)
- **Sources de données** :
  - [refuges.info](https://www.refuges.info) — [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)
  - [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass) — [ODbL](https://opendatacommons.org/licenses/odbl/)
  - [Camptocamp](https://www.camptocamp.org) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  - [DATAtourisme](https://www.datatourisme.fr) — [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence)
  - [SNCF Open Data](https://ressources.data.sncf.com) — [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence)
  - [transport.data.gouv.fr (PAN)](https://transport.data.gouv.fr) — [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence)
  - [Open-Meteo](https://open-meteo.com) — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  - [Vigilance Météo-France](https://portail-api.meteofrance.fr) — Licence Ouverte 2.0
- **Fond de carte** : tuiles [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)

Le GPX exporté liste dans `<copyright>` uniquement les sources réellement consultées, et chaque waypoint référence l'origine de la donnée. Le topo PDF reproduit la même attribution.

## Crédits

- L'équipe et la communauté de [refuges.info](https://www.refuges.info) pour leur travail extraordinaire d'inventaire collaboratif des refuges et cabanes des massifs français et européens.
- Les contributeurs et contributrices d'[OpenStreetMap](https://www.openstreetmap.org) et de [Camptocamp](https://www.camptocamp.org).
- [DATAtourisme](https://www.datatourisme.fr), la [SNCF](https://ressources.data.sncf.com), [transport.data.gouv.fr](https://transport.data.gouv.fr), [Open-Meteo](https://open-meteo.com) et [Météo-France](https://meteofrance.com) pour l'ouverture de leurs données.

## Contribuer

Les contributions sont bienvenues — ouvre une [issue](https://github.com/yoanbernabeu/refugesgpx/issues) ou une PR. Pour un bug côté API refuges.info, signaler [sur leur dépôt upstream](https://github.com/RefugesInfo/www.refuges.info) est généralement la bonne destination.
