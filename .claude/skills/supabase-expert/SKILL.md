---
name: supabase-expert
description: Expert Supabase couvrant Edge Functions, Row Level Security (RLS), schéma de base de données, triggers, politiques, realtime, storage et intégrations. Utilise ce skill dès que l'utilisateur mentionne Supabase, Edge Functions, RLS, politiques PostgreSQL, tables Supabase, auth Supabase, realtime subscriptions, pgvector, ou tout problème lié à un backend Supabase. Essentiel pour les projets React/TypeScript connectés à Supabase comme Delivroom/Delivroom.
---

# Supabase Expert

Référence complète pour construire, déboguer et optimiser des backends Supabase.

## Architecture de référence (projet Delivroom/Delivroom)

```
Supabase Project
├── Database (PostgreSQL 15)
│   ├── Tables: zones, scores, events, weather_cache, drivers, notifications
│   ├── RLS policies (par table)
│   └── Triggers (recalcul auto des scores)
├── Edge Functions (Deno)
│   ├── score-calculator (appelle Gemini 2.5 Flash)
│   ├── push-notifications
│   └── demand-aggregator
├── Realtime (WebSocket)
│   └── Subscriptions sur scores, zones
└── Auth (JWT)
    └── anon + authenticated roles
```

## Edge Functions

### Structure de base

```typescript
// supabase/functions/mon-edge-function/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase
      .from('zones')
      .select('*')
      .eq('active', true)

    if (error) throw error

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
```

### Déployer une Edge Function

```bash
supabase functions deploy mon-edge-function --no-verify-jwt
# Avec variables d'env
supabase secrets set GEMINI_API_KEY=xxx
```

### Appeler Gemini depuis une Edge Function

```typescript
const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    })
  }
)
const result = await geminiRes.json()
const score = result.candidates[0].content.parts[0].text
```

## Row Level Security (RLS)

### Activer RLS sur une table

```sql
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
```

### Politiques courantes

```sql
-- Lecture publique (anon peut lire)
CREATE POLICY "zones_public_read" ON zones
  FOR SELECT USING (true);

-- Écriture réservée aux utilisateurs authentifiés
CREATE POLICY "zones_auth_insert" ON zones
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Chaque driver ne voit que ses propres données
CREATE POLICY "driver_own_data" ON drivers
  FOR ALL USING (auth.uid() = user_id);

-- Service role bypass (pour les Edge Functions)
-- Le service role key contourne automatiquement le RLS
```

### Déboguer les politiques RLS

```sql
-- Tester une politique en se mettant dans la peau d'un utilisateur
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "user-uuid-ici"}';
SELECT * FROM zones;
```

## Triggers et fonctions PostgreSQL

### Recalcul automatique des scores

```sql
-- Fonction de recalcul
CREATE OR REPLACE FUNCTION recalculate_zone_score()
RETURNS TRIGGER AS $$
BEGIN
  -- Appeler une Edge Function via pg_net ou recalculer en SQL
  PERFORM net.http_post(
    url := current_setting('app.edge_function_url') || '/score-calculator',
    body := json_build_object('zone_id', NEW.id)::text,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger sur insertion/mise à jour
CREATE TRIGGER zone_score_update
  AFTER INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION recalculate_zone_score();
```

## Realtime Subscriptions (côté client React)

```typescript
import { supabase } from './supabaseClient'

// S'abonner aux changements de scores en temps réel
const channel = supabase
  .channel('scores-changes')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'scores' },
    (payload) => {
      console.log('Score mis à jour:', payload.new)
      updateMapMarker(payload.new)
    }
  )
  .subscribe()

// Cleanup
return () => { supabase.removeChannel(channel) }
```

## Schéma type pour Delivroom

```sql
-- Zones géographiques
CREATE TABLE zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  territory TEXT CHECK (territory IN ('montreal', 'laval', 'longueuil')),
  geom GEOMETRY(POLYGON, 4326), -- Nécessite PostGIS
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Scores de demande
CREATE TABLE scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
  score NUMERIC(4,2) CHECK (score BETWEEN 0 AND 10),
  factors JSONB, -- { weather: 0.8, events: 2, time_of_day: 1.5 }
  calculated_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_scores_zone_time ON scores(zone_id, calculated_at DESC);
```

## Erreurs fréquentes et solutions

| Erreur | Cause | Solution |
|---|---|---|
| `RLS policy violation` | Politique trop restrictive | Vérifier `auth.uid()` et le rôle |
| `CORS error` sur Edge Function | Headers manquants | Ajouter `corsHeaders` + gérer `OPTIONS` |
| Edge Function timeout | Traitement trop long | Réduire le payload, mettre en queue |
| `JWT expired` | Token client expiré | Rafraîchir avec `supabase.auth.refreshSession()` |
| Realtime ne se déclenche pas | RLS bloque le realtime | Ajouter politique SELECT pour `authenticated` |

## Commandes CLI utiles

```bash
supabase start                          # Démarrer en local
supabase db diff --schema public        # Voir les changements
supabase db push                        # Pousser les migrations
supabase functions serve score-calculator  # Tester localement
supabase logs --tail                    # Logs en temps réel
```
