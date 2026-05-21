# Delivroom

**Assistant intelligent pour chauffeurs gig — Montréal, Laval, Longueuil/Rive-Sud**

> React · Vite · TypeScript · Tailwind · Supabase · PWA · pgvector · Gemini 2.5 Flash

---

## Table des matières

1. [Stack technique](#stack-technique)
2. [Installation locale](#installation-locale)
3. [Variables d'environnement](#variables-denvironnement)
4. [Scripts disponibles](#scripts-disponibles)
5. [Architecture](#architecture)
6. [Base de données Supabase](#base-de-données-supabase)
7. [Edge Functions](#edge-functions)
8. [Tests](#tests)
9. [PWA](#pwa)
10. [Déploiement Vercel](#déploiement-vercel)
11. [CI/CD — Migrations Supabase](#cicd--migrations-supabase)
12. [APIs externes](#apis-externes)
13. [Anti-patterns interdits](#anti-patterns-interdits)
14. [Dépannage](#dépannage)

---

## Stack technique

| Couche      | Technologie                                        |
| ----------- | -------------------------------------------------- |
| Frontend    | React 19, Vite, TypeScript strict, Tailwind CSS    |
| UI          | Radix UI, shadcn/ui, Lucide icons                  |
| Carte       | Mapbox GL JS via react-map-gl / Leaflet (fallback) |
| Backend     | Supabase (Postgres, Edge Functions Deno, Realtime) |
| IA/Scoring  | Gemini 2.5 Flash via Edge Functions                |
| Vecteurs    | pgvector (ivfflat cosine, dimension 8)             |
| Tests       | Vitest + Testing Library, Playwright E2E           |
| PWA         | vite-plugin-pwa, service worker injectManifest     |
| Déploiement | Vercel (frontend), Supabase Cloud (backend)        |

---

## Installation locale

```bash
# Cloner le repo
git clone https://github.com/djlynx27/geohustle.git
cd geohustle

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env   # puis remplir les clés (voir section ci-dessous)

# Lancer en développement
npm run dev
```

> Prérequis : Node.js ≥ 20, npm ≥ 9

---

## Variables d'environnement

Copie `.env.example` en `.env` et renseigne chaque variable :

| Variable                  | Obligatoire  | Source / Comment                                    |
| ------------------------- | ------------ | --------------------------------------------------- |
| `VITE_SUPABASE_URL`       | ✅           | Supabase → Settings → API                           |
| `VITE_SUPABASE_ANON_KEY`  | ✅           | Supabase → Settings → API                           |
| `VITE_MAPBOX_TOKEN`       | ✅           | maps.mapbox.com → Tokens                            |
| `VITE_TOMTOM_KEY`         | ✅           | developer.tomtom.com → My Apps                      |
| `VITE_STM_KEY`            | ✅ (MTL)     | portail.developpeurs.stm.info — **GRATUIT**         |
| `VITE_TICKETMASTER_KEY`   | ⚡ optionnel | developer.ticketmaster.com — **GRATUIT**            |
| `VITE_AVIATIONSTACK_KEY`  | ⚡ optionnel | aviationstack.com — 100 req/mois. Fallback intégré. |
| `VITE_FOURSQUARE_API_KEY` | ⚡ optionnel | foursquare.com/developer                            |

> **Sécurité** : Ne jamais exposer `GEMINI_API_KEY` côté client. Elle est gérée exclusivement dans les Edge Functions Supabase via `supabase secrets set GEMINI_API_KEY=xxx`.

---

## Scripts disponibles

```bash
npm run dev           # Serveur de développement Vite (localhost:5173)
npm run build         # Build production → dist/
npm run preview       # Prévisualiser le build de production localement
npm run type-check    # Vérification TypeScript (tsc --noEmit) — zero erreur requis
npm run test          # Tests unitaires Vitest (watch mode)
npm run test:run      # Tests unitaires Vitest (run once, CI)
npm run test:e2e      # Tests E2E Playwright

# Supabase local
supabase start
supabase functions serve score-calculator

# Déploiement Edge Functions
supabase functions deploy score-calculator --no-verify-jwt
supabase secrets set GEMINI_API_KEY=xxx

# Déploiement Vercel
npx vercel login      # Authentification unique
npx vercel --prod --yes

# Génération et vérification des icônes PWA
node generate-pwa-icons.js
node check-pwa-icons.js

# Android TWA (Google Play)
bash scripts/setup-android-signing.sh
```

---

## Architecture

```
┌──────────────── Frontend (React/Vite/Tailwind) ────────────────────────┐
│  TodayScreen      → SurgeIndicator, ContextSimilarityPanel             │
│  DriveScreen      → PlatformArbitrage, DeadheadOptimizer               │
│  AdminScreen      → SurgeHistoryChart, WeightCalibratorPanel           │
│  PlanningScreen   → ShiftOptimizer, RevenueProjection                  │
└─────────────────────────────────────────────────────────────────────────┘
           │ supabase.functions.invoke() / supabase.from() + Realtime
           ▼
┌──────────────── Supabase Backend ───────────────────────────────────────┐
│  Edge Functions (Deno):                                                  │
│    score-calculator      → demande temps réel (OpenMeteo + Gemini)      │
│    ai-score-analysis     → analyse + recommandations zones              │
│    analyze-screenshot    → Gemini Vision (captures Lyft/DoorDash)       │
│    generate-daily-report → agrège trips → daily_reports                 │
│    context-embeddings    → pgvector CRUD + find_similar_contexts()      │
│    surge-detector        → scoring surge + capture vecteur contexte     │
│    platform-signal-collector → multi-platform demand par zone/slot      │
│    weight-calibrator     → feedback loop ML (EMA poids ×5)              │
│    push-notifier         → Web Push VAPID (background notifications)    │
│                                                                          │
│  pg_cron:                                                                │
│    */30 * * * * → recalculate_zone_scores()                             │
│    */5  * * * * → surge_detector (si delta score > 15%)                 │
└─────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────── APIs externes ──────────────────────────────────────────┐
│  Open-Meteo   → météo courante + prévisions 48h (≥gratuit, sans clé)   │
│  TomTom       → indice trafic temps réel                                │
│  STM GTFS-RT  → perturbations transit                                   │
│  Ticketmaster → événements Montréal/Laval                               │
│  AviationStack→ vols YUL (fallback statique si quota dépassé)           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Base de données Supabase

Tables principales :

| Table                  | Rôle                                               |
| ---------------------- | -------------------------------------------------- |
| `zones`                | Zones géographiques MTL/Laval/Longueuil            |
| `scores`               | Scores de demande par zone (0.0–10.0)              |
| `events`               | Événements (concerts, matchs, vols YUL…)           |
| `weather_cache`        | Cache météo Open-Meteo (TTL 30 min)                |
| `drivers`              | Profil chauffeur                                   |
| `notifications`        | Historique des notifs envoyées                     |
| `zone_context_vectors` | Vecteurs contextuels 8D (pgvector, ivfflat cosine) |
| `platform_signals`     | Signaux Lyft/DoorDash/Skip par zone/slot           |
| `weight_history`       | Historique des poids ML (feedback loop)            |
| `trip_predictions`     | Prédictions vs résultats réels                     |
| `push_subscriptions`   | Abonnements Web Push VAPID                         |

### Activer le module learning

```sql
-- Appliquer dans Supabase SQL Editor si CLI non disponible :
\i supabase/migrations/20260318_learning_foundation.sql
```

Ensuite :

1. Charge `supabase-seed.sql` via le SQL Editor.
2. Lance l'app → écran Admin → **Sync Supabase**.
3. Termine un shift pour peupler `ema_patterns`, `zone_beliefs`, `predictions`.
4. Le bloc **Contextes similaires** devient actif dès que le RPC `match_similar_contexts` est disponible.

---

## Edge Functions

Toutes les Edge Functions Deno suivent ces conventions :

```typescript
// TOUJOURS inclure
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// TOUJOURS gérer OPTIONS
if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders });
}
```

Déployer une fonction :

```bash
supabase functions deploy <nom-fonction> --no-verify-jwt
```

Secrets (jamais dans le code) :

```bash
supabase secrets set GEMINI_API_KEY=xxx
supabase secrets set VAPID_PRIVATE_KEY=xxx
```

---

## Tests

### Tests unitaires (Vitest)

```bash
npm run test:run     # CI
npm run test         # watch mode local
```

- Fichiers : `src/**/*.test.ts` / `src/**/*.test.tsx`
- Coverage cible : surgeEngine (46/46 ✅), learningEngine, demand scorer

### Tests E2E (Playwright)

```bash
npm run test:e2e
```

- Suites : `today`, `drive`, `admin`, `navigation`
- Config : [playwright.config.ts](playwright.config.ts)
- Résultats HTML : `playwright-report/`

### Type-check

```bash
npm run type-check   # tsc --noEmit — doit retourner 0 erreur
```

---

## PWA

- Plugin : `vite-plugin-pwa` avec `registerType: 'autoUpdate'`
- Service worker : `src/sw.ts` (strategy `injectManifest`)
- Icônes requises : `public/pwa-icon-192.png` et `public/pwa-icon-512.png`
- Générer les icônes : `node generate-pwa-icons.js`
- Vérifier les icônes : `node check-pwa-icons.js`
- Installable via Chrome sur Android/iOS (bouton "Ajouter à l'écran d'accueil")
- Notifications Web Push VAPID background via `useNotifications`

### Android TWA (Google Play Store)

```bash
bash scripts/setup-android-signing.sh   # génère keystore
```

Voir [twa-manifest.json](twa-manifest.json) pour la config TWA.

---

## Déploiement Vercel

1. Connecter le repo GitHub à Vercel (une seule fois)
2. **Build command** : `npm run build`
3. **Output directory** : `dist`
4. Ajouter toutes les variables d'env dans **Vercel → Settings → Environment Variables**
5. Push sur `main` → GitHub Actions applique les migrations → Vercel rebuild automatiquement

Ou déployer manuellement :

```bash
npx vercel login
npx vercel --prod --yes
```

Voir le guide complet : [README_DEPLOY.md](README_DEPLOY.md)

---

## CI/CD — Migrations Supabase

Le workflow `.github/workflows/supabase-migrations.yml` s'exécute automatiquement à chaque push sur `main` touchant `supabase/migrations/` ou `supabase-seed.sql`.

Secrets GitHub requis :

| Secret                  | Valeur                                          |
| ----------------------- | ----------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account Settings → Access tokens     |
| `SUPABASE_PROJECT_ID`   | Project ref (20 caractères) ou URL dashboard    |
| `SUPABASE_DB_PASSWORD`  | Database password (Project Settings → Database) |

Voir le guide complet : [docs/SUPABASE_MIGRATIONS_SETUP.md](docs/SUPABASE_MIGRATIONS_SETUP.md)

---

## APIs externes

| API           | Clé                       | Usage                           | Fallback                                         |
| ------------- | ------------------------- | ------------------------------- | ------------------------------------------------ |
| Open-Meteo    | _(aucune)_                | Météo + prévisions              | —                                                |
| Mapbox        | `VITE_MAPBOX_TOKEN`       | Carte principale dark-v11       | Leaflet + CartoDB dark tiles                     |
| TomTom        | `VITE_TOMTOM_KEY`         | Score trafic temps réel         | Score trafic à 0                                 |
| STM GTFS-RT   | `VITE_STM_KEY`            | Perturbations transit MTL       | Badge absent, app continue                       |
| Ticketmaster  | `VITE_TICKETMASTER_KEY`   | Événements Montréal/Laval       | Liste vide                                       |
| AviationStack | `VITE_AVIATIONSTACK_KEY`  | Vols YUL temps réel             | Vagues préprogrammées (6h-10h, 11h-14h, 17h-21h) |
| Foursquare    | `VITE_FOURSQUARE_API_KEY` | Points d'intérêt (bars, restos) | Liste vide                                       |
| Gemini 2.5    | `GEMINI_API_KEY` (secret) | Scoring IA + analyse zones      | Score neutre 5.0                                 |

---

## Anti-patterns interdits

- `any` TypeScript → utiliser `unknown` + type guard ou Zod
- `useEffect` sans cleanup sur subscriptions Supabase (memory leak)
- Clé `GEMINI_API_KEY` côté client (exposition de secret)
- Commits sur `main` sans `npm run type-check` passant à 0 erreur
- Edge Functions sans handler `OPTIONS` (CORS bloqué)
- Réponse Gemini sans `try/catch` + validation JSON stricte

---

## Dépannage

| Symptôme                          | Cause probable                     | Solution                                                          |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Page blanche en prod              | Vars d'env manquantes              | Vérifier Vercel → Settings → Env Vars                             |
| CORS bloqué sur Edge Function     | Handler OPTIONS absent             | Ajouter le handler OPTIONS dans la fonction                       |
| Badge STM absent                  | `VITE_STM_KEY` invalide ou absente | L'app continue sans — juste informatif                            |
| Score YUL = 0 / vols non affichés | Quota AviationStack dépassé        | Fallback statique activé automatiquement                          |
| Carte noire                       | `VITE_MAPBOX_TOKEN` invalide       | Vérifier le token Mapbox ou activer le fallback Leaflet           |
| `match_similar_contexts` absent   | Migration pgvector non appliquée   | Appliquer `20260318_learning_foundation.sql`                      |
| Push notifications non reçues     | VAPID keys manquantes              | `supabase secrets set VAPID_PUBLIC_KEY=xxx VAPID_PRIVATE_KEY=xxx` |

---

_Voir aussi : [README_DEPLOY.md](README_DEPLOY.md) · [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) · [CLAUDE.md](CLAUDE.md)_
