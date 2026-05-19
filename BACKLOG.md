# Backlog RefugesInfoApp

État au 19 mai 2026. Pistes identifiées au fil de la session "ajout de sources de données + refonte UX sidebar".

## Sources de données déjà intégrées

| Source | Type | Statut | Pipeline |
|---|---|---|---|
| refuges.info | Refuges, cabanes, gîtes, points d'eau, passages délicats | Live API | bbox + cache IndexedDB |
| OpenStreetMap (Overpass) | Points d'eau (sources, fontaines), commerces | Live API opt-in | bbox + cache IndexedDB |
| Camptocamp | Bivouacs | Live API opt-in | bbox + cache IndexedDB |
| SNCF | 2782 gares voyageurs France | Asset commité opt-in | `scripts/fetch-gares-sncf.mjs` |
| DATAtourisme | 128k hébergements (gîtes, B&B, hôtels, camping…) | Asset commité opt-in, par dépt | `scripts/fetch-datatourisme.mjs` |
| OpenStreetMap (Overpass) | Pharmacies, distributeurs, toilettes publiques | Live API opt-in | bbox + cache IndexedDB (`fetchAmenitiesOSM`, requête unique pour les 3) |

## Pistes prioritaires

### 1. Arrêts bus/cars PAN — **~2-3 jours, gros chantier**

Dataset "Arrêts de transport en France" sur data.gouv.fr (Point d'Accès National `transport.data.gouv.fr`), agrégat de tous les GTFS publics français.

- **416 MB de CSV brut** → trop pour un fetch client unique
- Solution recommandée : pipeline tippecanoe → PMTiles (~10-15 MB total, requêtes par tile)
- Couvre les TER, Cars Région, navettes estivales, réseaux urbains — utile quand la SNCF ne va pas (vallées étroites, haute montagne)
- Licence LOV2 (Etalab)

**Complexité** : tippecanoe à installer dans le build Netlify (ou pré-générer en local et commit), + intégration `pmtiles-js` dans MapView, + fetch par tile selon bbox trace.

### 2. Datatourisme phase 2 — restauration & sites naturels (au cas où)

Aujourd'hui on filtre uniquement `Accommodation`/`LodgingBusiness`. Si on veut étendre :

- **Restaurants** : `Restaurant`, `FoodEstablishment` (~10% des POIs DT)
- **Sites naturels** : `NaturalHeritage`, `Landform`, `Beach`, `ParkAndGarden`
- **Patrimoine** : `CulturalSite`, `Museum`, `ReligiousSite`

**Note** : pour les restaurants, OSM Overpass (`amenity=restaurant`) est probablement plus exhaustif que DT. À comparer avant d'investir.

## Pistes explorées mais écartées

| Piste | Raison de l'écart |
|---|---|
| Limites parcs nationaux / zones bivouac | User : "ça ne m'intéresse pas" |
| Sentiers FFRandonnée GR/PR | Pas en open data libre, modèle économique propriétaire |
| Météo / nivologie / BERA avalanche | Données temps-réel, incompatible avec app statique sans backend |
| Points d'eau municipaux (data.gouv) | Fragmenté par ville/métropole, OSM couvre déjà |
| Lot 3 transport "buffer extrémités" | User a préféré le buffer slider standard pour pouvoir court-circuiter à tout point de la trace |

## Idées UX en attente

### Presets one-click pour la sidebar
Idée évoquée dans le brainstorming du redesign sidebar mais pas implémentée. Sous le sélecteur de sources, 3 boutons larges :

- **Étape en refuge** = Dormir (refuges + cabanes + gîtes) + Boire (tout) + Attention
- **Bivouac autonome** = Dormir (bivouacs + cabanes) + Boire (tout) + Service + Attention
- **Tout afficher**

Ça pousse l'app du statut "outil de configuration" à "compagnon de prépa". ROI : très fort.

### Refonte taxonomique des sources annexes
Aujourd'hui la sidebar liste les sources par leur origine technique (refuges.info, OSM, Camptocamp…) dans le sous-menu de chaque catégorie. Sur le long terme, pourrait être complètement abstrait : l'utilisateur ne voit que les types de POI (gîte, refuge, eau…), l'origine technique est masquée. Mais ça demande de gérer la déduplication entre sources qui se chevauchent.

## Skills projet en place

- **`.claude/skills/refresh-gares-data/`** — rappel d'exécuter `node scripts/fetch-gares-sncf.mjs` avant commit/release. Seuils : 30/90 jours.
- **`.claude/skills/refresh-datatourisme-data/`** — idem pour DATAtourisme. Seuils plus laxistes : 90/180 jours (pipeline coûte ~5 min et 400 MB de DL).

Si on ajoute une nouvelle source avec asset commité (ex : Arrêts PAN), créer une skill jumelle.

## Conventions techniques importantes

- **App statique Astro SSG sur Netlify**, no backend, tout côté client. Les fetch external API se font dans le navigateur.
- **Assets de données commités** dans `public/data/`, pas régénérés au build Netlify.
- **Filtres opt-in** via `ANNEX_TYPE_KEYS` dans `src/lib/types.ts` — les sources annexes ne sont chargées que si activées dans la sidebar.
- **Cache IndexedDB** par bbox grid 0,02° (TTL 24h pour bbox, 7j pour fiche, 1h pour comments) via `src/lib/cache.ts`.
- **Toutes les licences ouvertes** (CC BY-SA / ODbL / LOV2 / fr-lo). Attribution dans le GPX `<copyright>` + popover (i) dans la sidebar.
- **Markers MapLibre** : registrer toutes les icônes via `loadAllMarkerImages()` au load. iconImage = `poi-${valeurAPI}`.
- **Identification de feature MapLibre** : toujours mettre `id` au top-level (pas seulement dans `properties.id`) sinon MapLibre ne peut pas diff correctement et laisse des markers fantômes.
- **setData + triggerRepaint** : toujours appeler `map.triggerRepaint()` après `setData()` pour éviter le décalage d'une frame.
- **Ne PAS gater l'update layer sur `isStyleLoaded()`** — c'est un piège connu (cf commit "Fix erratic POI markers"). `setData()` fonctionne quel que soit l'état du rebuild.

## UX d'attention

- **Sidebar 380 px**, layout serré. La liste POIs est LA valeur produit → préserver sa hauteur en priorité.
- **Sections sources repliées par défaut**, indicateur "X/Y" visible quand collapsed.
- **Boutons d'export** en sticky footer (toujours accessibles pendant le scroll).
- **Couleurs vives réservées aux markers carte** (la donnée). Monochrome + accent rouge sur les filtres (la navigation).
- **Header compact** (logo + 2 icônes) en haut.
- **TraceInfo en 1 ligne** avec stats condensées.
- **Pas de footer attribution** dans Panel (redondant avec popover (i) + attribution native MapLibre sur la carte).

## Commits récents (référence)

- `052ee93` — Add OSM pharmacies, ATMs and toilets; rename Ravito to Service
- `985e448` — Fix erratic POI markers when toggling source filters
- `b53ad6b` — Add DATAtourisme lodging + redesign sidebar UX
- `99d4d71` — Add SNCF train stations as opt-in annex source
- `6e05529` — Add basemap switcher (OSM / IGN Plan / IGN Ortho)
- `246b46b` — Add OSM shops (ravitaillement) as opt-in annex source
