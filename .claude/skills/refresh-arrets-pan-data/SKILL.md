---
name: refresh-arrets-pan-data
description: Vérifier la fraîcheur de l'asset arrêts de transport (`public/data/arrets-pan/`) et proposer d'exécuter la pipeline de refresh `node scripts/fetch-arrets-pan.mjs` avant un commit, un tag de version, une release ou un déploiement du projet RefugesInfoApp. À déclencher dès que l'utilisateur évoque un commit, un push, une release, un tag, un déploiement, une mise en prod, ou qu'il modifie le pipeline de fetch PAN ou les types/composants liés à `pan_arret`. Cette donnée est figée en commit (pas régénérée au build), donc si elle est ancienne, les utilisateurs finals voient des arrêts obsolètes (suppressions de lignes saisonnières, refontes de réseaux, ouvertures de pôles d'échange). Volume conséquent (~72 MB commité, 96 fichiers + index.json), donc à ne pas régénérer à chaque commit ordinaire — réserver pour les vraies releases. Ne PAS lancer la pipeline automatiquement — toujours demander confirmation au préalable.
---

# Refresh des arrêts de transport en commun (PAN) avant commit

## Contexte du projet

RefugesInfoApp est une app statique (Astro SSG sur Netlify). Les arrêts de transport en commun (bus, cars, TER routier, navettes) vivent dans `public/data/arrets-pan/` sous la forme d'un `index.json` + un fichier GeoJSON par département (`74.geojson` pour Haute-Savoie, `26.geojson` pour Drôme, etc.). Volume total commité : **~72 MB pour ~368 000 arrêts uniques sur 96 dépts métropole** (gzip Netlify ≈ 4-5 MB total servi).

Le dataset source est la **« Base nationale consolidée des arrêts de transport en commun »** publiée sur [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/arrets-de-transport-en-france) (Point d'Accès National, Etalab, LOV2). C'est un agrégat de tous les GTFS publics français — TER, Cars Région, navettes estivales, réseaux urbains.

**Particularité importante** : contrairement à DATAtourisme (régénéré quotidiennement à 3h), **ce dataset n'est pas régénéré automatiquement**. La page transport.data.gouv.fr indique explicitement : *« The file upload is not automated and data may be outdated, so you should refer to the last publication date »*. Le snapshot upstream peut donc rester figé plusieurs mois — vérifier la date publication avant de lancer le refresh.

**Coût du refresh** : ~400 MB de CSV téléchargés, parsing en ~5 s, point-in-polygon sur 96 contours dépts. Total typique : **moins d'une minute** sur une bonne connexion (beaucoup plus rapide que DATAtourisme qui fait 18 requêtes régionales séparées).

## Quand intervenir

Active cette vérification dans ces situations :

1. **L'utilisateur prépare une release, un tag de version, ou un déploiement** — c'est le moment principal. On veut shipper de la donnée fraîche.
2. **L'utilisateur a touché à `scripts/fetch-arrets-pan.mjs`**, à `src/lib/arrets-pan-api.ts`, au type `pan_arret` dans `src/lib/types.ts`, ou au dialog `PANArretDetailDialog` dans `src/components/POIDetailDialog.tsx` — refresh recommandé pour valider que le pipeline produit toujours un output cohérent avec ce que consomme le front.
3. **L'utilisateur demande explicitement** "refresh les arrêts", "regénère PAN", "update arrets-pan" ou équivalent — exécute la pipeline (toujours après confirmation du coût).
4. **L'utilisateur s'apprête à committer** un autre changement non-trivial alors que l'asset a plus de 6 mois — mention discrète seulement, pas de blocage.

Sur un commit ordinaire avec un asset récent, **ne rien dire**. Cette pipeline coûte du temps et touche 96 fichiers — pas raisonnable d'en faire un rituel à chaque commit.

## Procédure

### Étape 1 — Vérifier la fraîcheur

Date de notre asset local :

```bash
python3 -c "import json; print(json.load(open('public/data/arrets-pan/index.json'))['generated_at'])"
```

Ou plus simplement :

```bash
stat -f "%Sm" -t "%Y-%m-%d" public/data/arrets-pan/index.json
```

Avant de relancer, **vérifier aussi la date du snapshot upstream** (le dataset PAN n'est pas régénéré automatiquement — inutile de re-télécharger 400 MB si rien n'a bougé en amont) :

```bash
curl -s 'https://transport.data.gouv.fr/api/datasets/arrets-de-transport-en-france' | python3 -c "import sys, json; d=json.load(sys.stdin); r=d.get('resources',[{}])[0]; print('upstream last_update:', r.get('updated') or r.get('last_update'))"
```

Si la date upstream est antérieure à notre `generated_at`, le refresh ne ramènera rien de nouveau — informe l'utilisateur et propose de skipper.

### Étape 2 — Décider de proposer ou non

| Contexte | Âge < 90j | Âge 90-180j | Âge > 180j |
|---|---|---|---|
| Commit ordinaire | Rien à signaler | Rien à signaler | Mention discrète |
| Release / tag / deploy | Mention | **Proposer** | **Proposer fortement** |
| Modif du pipeline ou du dialog `pan_arret` | **Toujours regénérer** | idem | idem |

Le seuil est calqué sur DATAtourisme (90/180 jours), un peu plus laxiste que SNCF (30/90), parce que :
- Le dataset upstream n'est lui-même pas régénéré quotidiennement.
- Les arrêts physiques bougent peu (vs. les hébergements DT qui voient des ouvertures/fermetures saisonnières).
- Le coût de refresh reste non trivial (~400 MB et 96 fichiers modifiés).

### Étape 3 — Demander confirmation

Avant de lancer la pipeline, prévenir clairement l'utilisateur du coût :

> L'asset arrêts-PAN a été généré le 2026-05-19 (il y a 132 jours). Avant de tagger la version, je peux relancer la pipeline pour récupérer le snapshot upstream le plus récent. **Attention : ça télécharge ~400 MB de CSV depuis transport.data.gouv.fr et modifie ~96 fichiers (un par département)**. Le snapshot upstream date du 2026-01-13 — si celui-ci n'a pas bougé entre temps, le refresh ne ramènera rien.
>
> Je lance `node scripts/fetch-arrets-pan.mjs` ?

**N'exécute jamais la commande sans confirmation explicite**. Le user peut avoir une raison de différer (réseau lent, branche WIP, contrainte de timing).

### Étape 4 — Exécuter et intégrer au commit

Si le user confirme :

```bash
node scripts/fetch-arrets-pan.mjs
```

Le script affiche un compteur progressif + le top 5 des départements les plus volumineux à la fin. Output typique :

```
✓ 96 départements écrits · 70.85 MB
Top 5 dépts les plus volumineux :
  59 Nord                       15901 arrêts · 2824 KB
  38 Isère                      15384 arrêts · 3175 KB
  …
```

Le CSV temporaire est gardé en cache 24h dans `/tmp/arrets-pan.csv` — si tu relances le script dans la foulée, il réutilise le download au lieu de re-télécharger 400 MB.

Vérifie ensuite ce qui a changé :

```bash
git status public/data/arrets-pan/
git diff --stat public/data/arrets-pan/index.json
```

- Si le diff sur l'index est **vide** → tout est à jour. Les fichiers dept peuvent quand même bouger (re-tri JSON), pas grave.
- Si le diff sur l'index montre des comptes très différents (±20% sur plusieurs dépts d'un coup) → **alerte le user** : il y a probablement un changement upstream à investiguer (nouvelle agence intégrée, ancienne supprimée, schéma modifié).
- Sinon → c'est un refresh légitime, ajoute le dossier au commit en cours **avec un message dédié** ou en mention dans le message principal. Un refresh massif (~72 MB) ne devrait pas être mélangé avec un commit fonctionnel.

## Garde-fous

- **Ne jamais exécuter la pipeline sans confirmation** — le coût est non négligeable et l'asset upstream n'est pas régénéré quotidiennement.
- **Le nombre total d'arrêts attendu est ~300 000 à 450 000**. Si le script en retourne <200 000 ou >600 000, alerte le user : il y a probablement une régression côté source ou côté pipeline (changement de schéma CSV, contours dépts cassés…).
- **Le nombre de dépts attendu est 96** (métropole uniquement — le contour Etalab utilisé n'inclut pas les DOM). Si <90 ou >100, alerte.
- **Vérifier qu'aucun dépt n'est anormalement vide** : un dépt avec 0 arrêt après refresh alors qu'il en avait des milliers avant indique un problème dans le mapping point-in-polygon ou un changement de schéma CSV.
- **Si le download échoue** (HTTP 404, redirect cassé…) → le `resource_id` `81333` peut avoir changé côté transport.data.gouv.fr. Vérifier sur https://transport.data.gouv.fr/datasets/arrets-de-transport-en-france et mettre à jour `CSV_URL` dans le script. Idem si le contour des dépts (URL `gregoiredavid/france-geojson`) tombe en 404.
- **Ne pas confondre avec d'autres datasets**. Cette skill concerne uniquement `arrets-pan/`. Les gares SNCF sont gérées par `refresh-gares-data`, les hébergements par `refresh-datatourisme-data`.

## Pourquoi cette skill existe

Un asset statique de 72 MB commité dans le repo, c'est un cas particulier qu'il faut gérer avec soin. Si on refresh sans réfléchir, on alourdit l'historique git inutilement. Si on oublie de refresh, on shippe en prod des arrêts qui peuvent avoir un an ou plus — particulièrement gênant pour les navettes saisonnières dont l'ouverture annuelle peut bouger.

L'objectif est de rendre le refresh **conscient et rituel au moment des vraies releases** — pas un automatisme, pas un oubli. Le développeur garde la décision mais sait quand et pourquoi le faire.
