# Delivroom — Guide de déploiement Vercel

## 1. Prérequis

- Compte Vercel (vercel.com) connecté au dépôt GitHub
- Projet Supabase avec URL + anon key
- Clé Mapbox (maps.mapbox.com)

## 2. Variables d'environnement Vercel

Dans **Vercel → Settings → Environment Variables**, ajouter :

| Variable                  | Obligatoire  | Source                                       |
| ------------------------- | ------------ | -------------------------------------------- |
| `VITE_SUPABASE_URL`       | ✅           | Supabase → Settings → API                    |
| `VITE_SUPABASE_ANON_KEY`  | ✅           | Supabase → Settings → API                    |
| `VITE_MAPBOX_TOKEN`       | ✅           | maps.mapbox.com → Tokens                     |
| `VITE_TOMTOM_KEY`         | ✅           | developer.tomtom.com → My Apps               |
| `VITE_STM_KEY`            | ✅ (MTL)     | portail.developpeurs.stm.info — **GRATUIT**  |
| `VITE_AVIATIONSTACK_KEY`  | ⚡ optionnel | aviationstack.com — plan Free (100 req/mois) |
| `VITE_TICKETMASTER_KEY`   | ⚡ optionnel | developer.ticketmaster.com — **GRATUIT**     |
| `VITE_FOURSQUARE_API_KEY` | ⚡ optionnel | foursquare.com/developer                     |

### Obtenir la clé STM (5 min, gratuit)

1. Aller sur **portail.developpeurs.stm.info**
2. Créer un compte → **Créer une application**
3. Activer le produit **GTFS-RT** (serviceAlerts, vehiclePositions, tripUpdates)
4. Copier la clé API → `VITE_STM_KEY` dans Vercel

### Obtenir la clé AviationStack (optionnel)

1. **aviationstack.com** → Sign Up Free
2. 100 requêtes/mois (mises en cache 4h dans l'app = largement suffisant)
3. Sans cette clé : l'app utilise les vagues YUL préprogrammées (6h-10h, 11h-14h, 17h-21h)

## 3. Déploiement

1. `git push origin main` depuis le projet
2. GitHub Actions applique automatiquement les migrations Supabase
3. Vercel détecte le push et builds/déploie automatiquement

## 4. Notes

- PWA Vite — export statique géré par Vercel
- Toutes les routes sont SPA (rewrite dans `vercel.json`)
- Migrations Supabase : voir `.github/workflows/supabase-migrations.yml`

## 5. Dépannage

- Page blanche → vérifier les vars d'env et CORS Supabase (autoriser le domaine Vercel)
- STM badge absent → `VITE_STM_KEY` manquante ou clé invalide (l'app continue de fonctionner normalement)
- YUL badge — fonctionne sans clé AviationStack (schedule statique intégré)

---

## 6. Google Play Store (TWA — Trusted Web Activity)

### Prérequis

- JDK 11+ installé (`keytool` disponible)
- Node.js 20+

### Étapes en 6 minutes

**1. Générer le keystore de signature :**

```bash
bash scripts/setup-android-signing.sh
```

Le script génère `android.keystore`, affiche le SHA-256 et le base64 à copier.

**2. Mettre à jour `public/.well-known/assetlinks.json` :**
Remplacer `REMPLACER_PAR_SHA256_DU_KEYSTORE` par le SHA-256 affiché.
Format : `AA:BB:CC:DD:...` (32 paires hex séparées par `:`).

**3. Mettre à jour `twa-manifest.json` :**
Si tu as un domaine custom, changer `host` (ex: `delivroom.app` au lieu de `delivroom.vercel.app`).

**4. Ajouter les 3 GitHub Secrets :**
→ GitHub → Repo → Settings → Secrets and variables → Actions

| Secret                       | Valeur                  |
| ---------------------------- | ----------------------- |
| `ANDROID_KEYSTORE_BASE64`    | sortie base64 du script |
| `ANDROID_KEYSTORE_PASSWORD`  | mot de passe choisi     |
| `ANDROID_KEY_ALIAS_PASSWORD` | idem (ou différent)     |

**5. Pousser le tag pour déclencher le build :**

```bash
git tag v1.0.0
git push --tags
```

Le workflow `.github/workflows/build-apk.yml` build l'APK et l'AAB, crée une GitHub Release.

**6. Uploader sur Play Console :**

- `app-release.aab` → Google Play Console → Production → Nouvelle version
- Remplir la fiche (nom, description, captures d'écran)
- Soumettre pour révision (~3 jours)

> ⚠️ **IMPORTANT** : Sauvegarder `android.keystore` hors du dépôt (Google exige la même clé pour toutes les mises à jour — si perdue, impossibled e mettre à jour l'app sur le Play Store).
