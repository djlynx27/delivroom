# CLAUDE.md — Delivroom

Ce fichier est lu automatiquement par Claude Code à chaque session.

---

## Contexte projet

**App :** Delivroom (anciennement HustleGo, renommé 2026-05-21)
**Repo :** github.com/djlynx27/delivroom
**Stack :** React 19 + Vite 7 + TypeScript 5.9 strict + Tailwind 3.4 + Supabase
**Hosting :** Vercel (project `delivroom`, team `djlynx27s-projects`)
**Mobile :** Capacitor 8 (Android) + TWA (PWA installable)
**Tests :** Vitest 4 + Playwright 1.58
**Umbrella business :** Hustle Go Media — Delivroom est UN des side hustles, ne pas mélanger les deux contextes

### Territoires

Montréal, Laval, Longueuil/Rive-Sud — 61 zones actives

### Plateformes chauffeur

Lyft, Hypra (Taxi Express Plan F), Imoove

### IDs externes (immuables — ne pas modifier)

| Service | ID |
|---|---|
| Supabase project ref | `hibzhsjgipybfihhzpxr` (name: Delivroom, region ca-central-1) |
| Vercel project ID | `prj_79tYnjLTxeNdp7Uher6cRv2oyCLX` |
| Vercel team ID | `team_qGbQ44wwG6Kp3KR1OFOAwlgD` |
| Android appId | `com.delivroom.app` |
| TWA packageId | `app.delivroom.driver` |

### Tables Supabase (25 — toutes avec RLS activé)

**Core scoring :** zones, scores, cities, events, demand_patterns, ema_patterns, zone_beliefs, predictions, weight_history
**Trips & sessions :** sessions, session_zones, trips, trips_raw, time_slots, trip_predictions, zone_performance
**ML/AI :** zone_context_vectors (pgvector ivfflat), platform_signals
**Driver state :** daily_reports, notifications, push_subscriptions, user_pings, user_profiles
**Payments :** stripe_events
**Content :** content_pipeline

### Edge Functions (10 déployées)

| Function | Rôle |
|---|---|
| score-calculator | Scoring zone via Gemini 2.5 Flash |
| ai-score-analysis | Analyse explicative scores |
| analyze-screenshot | OCR/vision screenshots plateformes |
| generate-daily-report | Rapport quotidien revenus |
| context-embeddings | pgvector embeddings 8D zones |
| surge-detector | Détection multiplicateurs surge |
| platform-signal-collector | Collecte signaux Lyft/Hypra |
| weight-calibrator | Calibration poids facteurs scoring |
| push-notifier | Web Push VAPID |
| lyft-zone-scanner | Scanner zones Lyft (⚠️ déployée mais absente du repo local — à investiguer) |

### Migrations

19 migrations dans `supabase/migrations/` — toutes appliquées sur prod (vérifié 2026-05-21).

---

## Conventions de code

- TypeScript **strict** — zero `any`, zero `as any`, `unknown` + type guard à la place
- Named exports uniquement, jamais de `default export`
- `as const` > enums
- Commits conventional : `feat(scope):` / `fix(scope):` / `chore(scope):` / `refactor(scope):` / `docs(scope):` — en anglais
- Branches : `feature/xxx`, `fix/xxx`, `hotfix/xxx`, `chore/xxx`
- Format Prettier : 2 espaces, pas de semi, single quotes

---

## Anti-patterns interdits

- `any` TypeScript → `unknown` + type guard / Zod
- `useEffect` sans cleanup sur subscriptions Supabase
- Clés API sensibles côté client (Gemini, service_role) — Edge Functions only
- Edge Functions sans handler `OPTIONS` + `corsHeaders` + try/catch
- Score Gemini sans validation JSON stricte
- `git push --no-verify` sauf urgence documentée
- Modifier code hors scope — `// FIXME(claude): description` à la place
- Migrations SQL modifiées après application sur prod

---

## Skills actifs (`.claude/skills/`)

`supabase-expert`, `ai-scoring-engine`, `demand-forecaster`, `react-native-pwa`, `typescript-strict`, `api-integrator`, `map-visualizer`, `surge-engine`, `git-workflow`, `shift-planner`

Lire le `SKILL.md` correspondant pour le détail. Note : ces skills sont post-rename Delivroom mais peuvent référencer des concepts hérités du nom HustleGo dans certaines descriptions.

---

## Commandes fréquentes

```powershell
# Dev
npm run dev
supabase functions serve score-calculator

# Validation pré-commit
npm run type-check
npm run lint
npm run test:run

# Deploy Edge Function
supabase functions deploy score-calculator --no-verify-jwt
supabase secrets set GEMINI_API_KEY=xxx

# E2E
npm run test:e2e

# Android
npx cap sync android
```

---

## Architecture — Progressive Disclosure Architecture (PDA)

### Evidence-First Exploration
Avant toute modif : lire fichiers ouverts + README + CLAUDE.md, `package.json`, `tsconfig.json`, `.env.example`, `git log --oneline -20`, commentaires `TODO/FIXME/HACK`. Ne jamais modifier du code non lu.

### Complexité cyclomatique
Seuil **M ≤ 10** (ISO 25010). ESLint rule active. Fonctions > 10 branches → extraire en sous-fonctions.

### Couverture tests (cibles ISO 25010)

| Métrique   | Actuel | Cible |
|---|---|---|
| Statements | ≥ 78% | ≥ 80% |
| Branches   | ≥ 65% | ≥ 80% |
| Functions  | ≥ 83% | ≥ 85% |
| Lines      | ≥ 80% | ≥ 85% |

Thresholds dans `vitest.config.ts`. Build CI échoue sous seuil.

### Software Immunology
À chaque session : `npm run type-check`, `npm run lint`, `npm run test:run`. Gitleaks dans CI.

### Antifragilité — protocole obstacles
1. Résoudre à la source → 2. Modifier alentour → 3. Contourner → 4. Recréer → 5. Imiter. Documenter ce qui a été contourné.

### Validation chain pré-commit
```bash
npm run test:run && npm run type-check && npm run lint && git commit -m "type(scope): description"
```

### Souveraineté des données
- Gemini : Edge Functions uniquement, jamais côté client
- Aucune donnée user envoyée à APIs tierces sans consentement
- Edge Functions : `corsHeaders` + handler `OPTIONS` + try/catch obligatoires
