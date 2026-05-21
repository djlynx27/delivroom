# Plan d'Implémentation Delivroom — Écosystèmes Transport à la Demande

Source: Analyse Avancée des Écosystèmes de Transport à la Demande (rapport Deep Research)
Date: 2026-03-20 | Stack: React + Vite + TypeScript + Tailwind + Supabase + pgvector

---

## Synthèse du rapport

Le rapport identifie **5 leviers de rendement $/h** pour un chauffeur multi-plateforme à Montréal :

1. **Surge detection** — anticiper la prime de surcharge avant qu'elle apparaisse sur l'app (lead time ~12 min)
2. **Deadhead minimization** — réduire les km à vide (coût moyen : 0.18 $/km pour Santa Fe Sport 2018)
3. **Platform arbitrage** — basculer entre Lyft / DoorDash / Skip selon la demande en temps réel
4. **Context similarity** — trouver dans l'historique les situations similaires (vecteur 8D via pgvector)
5. **Shift timing** — aligner les heures de travail sur les fenêtres de rendement max (vendredi soir, barres 02h00)

---

## Architecture cible

```
┌─────────────────── Frontend (React/Vite/Tailwind) ────────────────────┐
│  TodayScreen           → SurgeIndicator, ContextPanel                 │
│  DriveScreen           → PlatformArbitrage, DeadheadOptimizer         │
│  AdminScreen           → SurgeHistoryChart, WeightCalibrator          │
│  PlanningScreen        → ShiftOptimizer, RevenueProjection            │
└────────────────────────────────────────────────────────────────────────┘
         │ supabase.functions.invoke() / supabase.from()
         ▼
┌─────────────── Supabase Backend ───────────────────────────────────────┐
│  Edge Functions:                                                        │
│    score-calculator      → demande temps réel (OpenMeteo + Gemini)     │
│    ai-score-analysis     → analyse zones + recommandations             │
│    analyze-screenshot    → Gemini Vision (captures Lyft/DoorDash)      │
│    generate-daily-report → agrège trips → daily_reports               │
│    context-embeddings    → pgvector CRUD + find_similar_contexts()     │
│    surge-detector   [NEW]→ surge scoring + capture vecteur contexte    │
│                                                                        │
│  Tables:                                                               │
│    zones, scores, events, trips, time_slots, daily_reports             │
│    zone_context_vectors  [NEW] — vector(8), ivfflat index              │
│    weight_history        [NEW] — feedback loop ML                      │
│    platform_signals      [NEW] — Lyft/DoorDash demand par zone/slot    │
│                                                                        │
│  pg_cron:                                                              │
│    */30 * * * * → recalculate_zone_scores()                           │
│    */5  * * * * → surge_detector (si score delta > 15%)               │
└────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌───── APIs externes ───────────────────────────────────────────────────┐
│  Open-Meteo   → météo courante + prévisions 48h (gratuit)             │
│  Ticketmaster → événements Montréal/Laval                             │
│  TomTom       → indice trafic temps réel (usefulness: ★★★★☆)         │
│  STM GTFS-RT  → perturbations transit (usefulness: ★★★☆☆)           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Priorités — 4 Phases (MoSCoW + effort)

### PHASE 1 — Fondations (✅ DONE)

| #   | Livrable                                        | Fichier                                 | Status |
| --- | ----------------------------------------------- | --------------------------------------- | ------ |
| 1.1 | Tables zones, scores, events, trips, time_slots | migrations 01–06                        | ✅     |
| 1.2 | score-calculator Edge Function                  | `supabase/functions/score-calculator/`  | ✅     |
| 1.3 | ai-score-analysis Edge Function                 | `supabase/functions/ai-score-analysis/` | ✅     |
| 1.4 | Mode libre + smart zones GPS                    | `TodayScreen.tsx`                       | ✅     |
| 1.5 | Realtime scores subscription                    | `useZoneScores.ts`                      | ✅     |
| 1.6 | Bayesian learning engine (EMA + prédictions)    | `learningEngine.ts`                     | ✅     |

---

### PHASE 2 — Surge Engine + pgvector (✅ DONE)

**Objectif :** détecter les surges 10–15 min en avance via context similarity

| #   | Livrable                                     | Agent responsable    | Effort | Status |
| --- | -------------------------------------------- | -------------------- | ------ | ------ |
| 2.1 | `surgeEngine.ts` — moteur surge + vecteur 8D | Data Scientist       | S      | ✅     |
| 2.2 | Migration pgvector `zone_context_vectors`    | Architecte           | S      | ✅     |
| 2.3 | `context-embeddings` Edge Function           | Integration Engineer | M      | ✅     |
| 2.4 | `SurgeIndicator` composant React             | Frontend Dev         | M      | ✅     |
| 2.5 | Intégration surge dans `useDemandScores`     | Frontend Dev         | S      | ✅     |
| 2.6 | `surge-detector` Edge Function (cron 5 min)  | Integration Engineer | M      | ✅     |

---

### PHASE 3 — Platform Arbitrage + Deadhead (✅ DONE)

**Objectif :** afficher le meilleur choix de plateforme par zone/moment

| #   | Livrable                                  | Agent responsable    | Effort | Status |
| --- | ----------------------------------------- | -------------------- | ------ | ------ |
| 3.1 | Table `platform_signals` en BDD           | Architecte           | S      | ✅     |
| 3.2 | `platform-signal-collector` Edge Function | Integration Engineer | L      | ✅     |
| 3.3 | `PlatformArbitrage` composant             | Frontend Dev         | M      | ✅     |
| 3.4 | Score deadhead en mode libre              | Data Scientist       | S      | ✅     |
| 3.5 | Notification "Bascule vers DoorDash"      | Integration Engineer | M      | ✅     |

---

### PHASE 4 — Feedback Loop ML + Shift Optimizer (✅ DONE)

**Objectif :** améliorer la précision du modèle avec les vrais résultats de conduite

| #   | Livrable                                    | Agent responsable | Effort | Status |
| --- | ------------------------------------------- | ----------------- | ------ | ------ |
| 4.1 | Table `weight_history`                      | Architecte        | S      | ✅     |
| 4.2 | `weight-calibrator` Edge Function           | Data Scientist    | L      | ✅     |
| 4.3 | Post-trip comparison `prediction vs actual` | Data Scientist    | M      | ✅     |
| 4.4 | `ShiftOptimizer` — planning hebdomadaire IA | Frontend Dev      | L      | ✅     |
| 4.5 | Rapport revenus multi-plateforme            | Frontend Dev      | M      | ✅     |

---

### PHASE 5 — Architecture Completion + QA (✅ DONE)

**Commit :** `82b29ae` — feat(arch): Phase 5 complete
**Objectif :** combler les gaps d'architecture identifiés mais non livrés dans les phases précédentes

| #   | Livrable                                                          | Agent responsable | Effort | Status |
| --- | ----------------------------------------------------------------- | ----------------- | ------ | ------ |
| 5.1 | `ContextSimilarityPanel` — pgvector k-NN results in TodayScreen   | Frontend Dev      | M      | ✅     |
| 5.2 | `WeightCalibratorPanel` — Admin UI (GET weights + POST calibrate) | Frontend Dev      | M      | ✅     |
| 5.3 | `SurgeIndicator + PlatformArbitrage` dans DriveScreen             | Frontend Dev      | S      | ✅     |
| 5.4 | `surgeEngine.test.ts` — 46 cas Vitest (46/46 ✅)                  | QA                | M      | ✅     |
| 5.5 | Format EF `weight-calibrator` unifié (clés `w_*` flat)            | Integration Eng.  | S      | ✅     |

**Notes techniques :**

- `adjustedBaseline = baselineScore × DOW × seasonal` — les seuils de surge s'appliquent au multiplicateur (1.0–2.5×), pas au ratio brut
- `surgeEngine.ts` : à ratio=1.0 → sigmoid(0)=0.5 → multi=1.75 (classe 'high') — comportement intentionnel
- EF GET `weight-calibrator` retourne désormais flat `{w_time, w_day, w_weather, w_events, w_historical, mae, accuracy_pct, history[]}`

---

### PHASE 6 — E2E + Web Push VAPID (✅ DONE)

**Objectif :** sécuriser les flows critiques UI et envoyer de vraies notifications push background via service worker

| #   | Livrable                                                       | Agent responsable    | Effort | Status |
| --- | -------------------------------------------------------------- | -------------------- | ------ | ------ |
| 6.1 | Suite Playwright E2E (`today`, `drive`, `admin`, `navigation`) | QA                   | M      | ✅     |
| 6.2 | `playwright.config.ts` + script `npm run test:e2e`             | QA                   | S      | ✅     |
| 6.3 | Migration `push_subscriptions` + RLS                           | Architecte           | S      | ✅     |
| 6.4 | Edge Function `push-notifier` (VAPID)                          | Integration Engineer | M      | ✅     |
| 6.5 | Service worker custom `src/sw.ts` + `injectManifest`           | Frontend Dev         | M      | ✅     |
| 6.6 | `useNotifications` — souscription VAPID côté client            | Frontend Dev         | M      | ✅     |
| 6.7 | `surge-detector` → dispatch réel vers `push-notifier`          | Integration Engineer | S      | ✅     |

**Validation :**

- `npx tsc --noEmit` → OK
- `npx vitest run src/test/surgeEngine.test.ts` → 46/46 ✅
- `npx playwright test` → 25/25 ✅

---

## Rôles agents et responsabilités

### 🏗️ Architecte

- Schéma BDD : nouvelles tables + FK + index
- Migration files (timestamps séquentiels `202603XX000X`)
- RLS policies pour chaque table
- pg_cron schedule + cleanup functions
- **Fichiers**: `supabase/migrations/**`

### 📊 Data Scientist

- Calibration des poids (TIME × DOW × WEATHER × EVENTS × SURGE)
- Algorithme surge : sigmoid + seuils + multiplicateurs saisonniers Montréal
- Vecteurs contextuels 8D : normalisation, similarité cosinus
- EMA learning (α=0.15 baseline, α=0.3 pour sur-apprentissage rapide)
- Modèle stochastique bayésien (prior, posterior variance)
- **Fichiers**: `src/lib/surgeEngine.ts`, `src/lib/learningEngine.ts`

### ⚡ Integration Engineer

- Edge Functions Deno : CORS, service role key, OPTIONS handler
- APIs externes : OpenMeteo, TomTom, STM GTFS-RT
- pgvector upsert + nearest-neighbor queries
- Push notifications (service worker + Supabase)
- **Fichiers**: `supabase/functions/**`

### 🎨 Frontend Dev

- Composants React (SurgeIndicator, PlatformArbitrage, ContextPanel)
- Hooks : useSurge, usePlatformSignals
- Tailwind dark theme : rouge/orange surge, vert normal
- Animations : score change transitions, surge pulse
- **Fichiers**: `src/components/**`, `src/hooks/**`

### 🧪 QA

- Vitest : surgeEngine.test.ts (35+ cas limites)
- Playwright : flow complet TodayScreen → Mode libre → Navigation
- Tests de charge : 40 zones × 48h → 1920 calculs
- **Fichiers**: `src/**/*.test.ts`

---

## Seuils de surge calibrés Montréal

| Classe | Ratio actuel/baseline | Multiplicateur | Boost $/h estimé |
| ------ | --------------------- | -------------- | ---------------- |
| Normal | < 1.18                | 1.00 – 1.17    | +0%              |
| Élevé  | 1.18 – 1.44           | 1.17 – 1.49    | +15 – 30%        |
| Surge  | 1.45 – 1.79           | 1.50 – 1.79    | +30 – 60%        |
| PEAK   | ≥ 1.80                | 1.80 – 2.50    | +60 – 150%       |

### Signaux déclencheurs Montréal

- Vendredi 22h00–03h30 : nightlife + bars = surge assuré Plateau/Mile End
- Blizzard (précip > 8mm/h) : +0.4 score météo → surge immédiat
- Concert Centre Bell / MTelus / Osheaga : +0.5 event proximity zones voisines
- STM en panne : transitDisruption → surge métro zones proches
- GP de Montréal (juin) : surcharge totale zone Notre-Dame/Île
- 02h00–03h30 tout soir : bar closing surge (toutes zones nightlife)

---

## Flux de données — Context Similarity Pipeline

```
Chaque 15 min (score-calculator) :
  1. Calcul score zone (Open-Meteo + DB events + time rules)
  2. surgeEngine.computeSurge(ctx) → { surgeMultiplier, contextVector[8] }
  3. supabase.functions.invoke('context-embeddings', {
       zone_id, context_vector, surge_multiplier, surge_class
     })
  4. Stockage dans zone_context_vectors

À chaque affichage zone (Mode libre) :
  1. Construire contextVector[8] depuis état actuel
  2. supabase.rpc('find_similar_contexts', { p_zone_id, p_vector, p_limit: 10 })
  3. Afficher "Dans des situations similaires : +$XX/h en moyenne"
  4. Mettre en cache 5 min (React Query)
```

---

## Commandes clés

```powershell
# Déployer la migration pgvector
supabase db push --password $SUPABASE_DB_PASSWORD

# Déployer le nouvel Edge Function
supabase functions deploy context-embeddings --no-verify-jwt

# Tester localement
supabase functions serve context-embeddings
curl -X POST http://localhost:54321/functions/v1/context-embeddings \
  -H "Content-Type: application/json" \
  -d '{"zone_id":"xxx","context_vector":[0.5,0.7,0.2,0.1,0.3,0.8,0.9,0.6],"surge_multiplier":1.45,"surge_class":"elevated","trip_count":3}'

# Tests unitaires surge engine
npm run test -- --watch surgeEngine
```
