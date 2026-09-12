---
name: surge-engine
description: "Moteur de détection de surge en temps réel (computeSurge, vecteur de contexte 8D pgvector, recherche de similarité historique) pour les zones taxi/gig Montréal. Référence quand on touche src/lib/surgeEngine.ts, context-embeddings, ou le calcul du multiplicateur de surge."
---

# SKILL.md — surge-engine

## Domaine

Détection de surges de demande en temps réel pour chauffeurs gig (Lyft, DoorDash, SkipTheDishes) dans l'écosystème montréalais. Produit un multiplicateur de prime (1.0–2.5×) + vecteur de contexte 8D stocké via pgvector pour recherche de similarité historique.

---

## Architecture

```
SurgeContext (8 inputs)
       ↓
computeSurge() [src/lib/surgeEngine.ts]
       ↓
SurgeResult { surgeMultiplier, surgeScore, surgeClass, contextVector[8], reasoning }
       ↓
context-embeddings Edge Function → zone_context_vectors (pgvector)
       ↓
find_similar_contexts() → "Dans des situations similaires : +$XX/h"
```

---

## Fichiers clés

| Fichier                                                   | Rôle                                  |
| --------------------------------------------------------- | ------------------------------------- |
| `src/lib/surgeEngine.ts`                                  | Moteur surge + vecteur contexte 8D    |
| `supabase/functions/context-embeddings/index.ts`          | Edge Function pgvector CRUD           |
| `supabase/migrations/20260320000001_pgvector_context.sql` | Table + IVFFlat index + SQL functions |

---

## Vecteur contexte 8D

```
[0] hour_norm        = hour / 23                              ∈ [0,1]
[1] dow_norm         = dayOfWeek / 6                          ∈ [0,1]
[2] weather_norm     = weatherScore / 100                     ∈ [0,1]
[3] event_norm       = eventProximity / 100                   ∈ [0,1]
[4] traffic_norm     = trafficIndex / 100                     ∈ [0,1]
[5] surge_ratio_norm = clamp(currentScore/baseline, 0, 3) / 3 ∈ [0,1]
[6] deadhead_inv     = 1 - clamp(deadheadKm / 30, 0, 1)      ∈ [0,1]
[7] seasonal_norm    = (seasonalIndex - 0.85) / 0.35          ∈ [0,1]
```

Similarité cosinus dans pgvector : `context_vector <=> p_vector`

---

## Classes de surge (seuils ratio actuel/baseline)

| Classe   | Seuil ratio | Multiplicateur | Boost $/h |
| -------- | ----------- | -------------- | --------- |
| normal   | < 1.18      | 1.00 – 1.17    | 0%        |
| elevated | 1.18 – 1.44 | 1.17 – 1.49    | +15–30%   |
| high     | 1.45 – 1.79 | 1.50 – 1.79    | +30–60%   |
| peak     | ≥ 1.80      | 1.80 – 2.50    | +60–150%  |

---

## Index saisonniers Montréal

```typescript
// Jan  Fév  Mar  Avr  Mai  Jun  Jul  Aoû  Sep  Oct  Nov  Déc
[1.15, 1.12, 1.05, 0.95, 0.9, 1.02, 1.1, 1.08, 1.0, 0.95, 0.98, 1.18];
```

Juillet = Grand Prix + festivals. Décembre = fêtes. Hiver Jan–Fév = prime conducteur.

---

## Usage dans React

```typescript
import {
  computeSurge,
  buildSurgeContext,
  getSurgeDisplay,
} from '@/lib/surgeEngine';

// Dans useDemandScores ou TodayScreen :
const surgeCtx = buildSurgeContext({
  now,
  currentScore: scores.get(zone.id) ?? 50,
  baselineScore: 50, // TODO: depuis get_surge_baseline()
  weatherScore: weather?.demandBoostPoints ?? 0,
  eventProximity: activeEvents.length > 0 ? 70 : 0,
  trafficIndex: trafficData?.index ?? 0,
  deadheadKm: getDistance(zone) ?? 5,
});
const surge = computeSurge(surgeCtx);
const display = getSurgeDisplay(surge.surgeClass);
```

---

## Stockage vecteur après calcul

```typescript
// Après chaque recalcul score-calculator / useDemandScores :
await supabase.functions.invoke('context-embeddings', {
  body: {
    zone_id: zone.id,
    context_vector: Array.from(surge.contextVector),
    surge_multiplier: surge.surgeMultiplier,
    surge_class: surge.surgeClass,
  },
});
```

---

## Recherche de similarité

```typescript
// Trouver les 10 situations historiques les plus proches :
const { data } = await supabase.functions.invoke('context-embeddings', {
  body: {
    action: 'query',
    zone_id: zone.id,
    context_vector: Array.from(surge.contextVector),
    limit: 10,
    min_trips: 1,
  },
});
// data.predicted_earnings_per_hour → prédiction $/h basée sur le passé
// data.similar[]  → liste avec .similarity (cosinus), .surge_class, etc.
```

---

## Feedback loop (post-course)

```typescript
// Après TripLogger.onTripComplete() :
await supabase.functions.invoke('context-embeddings', {
  body: {
    action: 'update_outcome',
    id: vectorId, // retourné lors du stockage
    actual_earnings_per_hour: earnings / hours,
    trip_count: 1,
  },
});
```

---

## Anti-patterns

- ❌ Ne jamais appeler `computeSurge()` sans baselineScore valide — utiliser `get_surge_baseline()` via Edge Function
- ❌ Ne jamais exposer la clé Gemini côté client
- ❌ Ne pas stocker de vecteur si surge_class = 'normal' et trip_count = 0 (bruit)
- ✅ Toujours valider que contextVector a exactement 8 dimensions avant insertion
- ✅ Purge automatique > 90 jours via `cleanup_old_context_vectors()` (pg_cron 03:00)
