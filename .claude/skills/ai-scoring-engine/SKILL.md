---
name: ai-scoring-engine
description: Conception et implémentation de moteurs de scoring IA via Edge Functions Supabase appelant Gemini ou d'autres LLMs. Utilise ce skill dès que l'utilisateur veut faire scorer des données par un LLM, construire un pipeline IA de scoring, intégrer Gemini 2.5 Flash dans une Edge Function, ou automatiser le recalcul de scores basé sur l'IA. Directement applicable à Delivroom/Delivroom.
---

# AI Scoring Engine

Construction d'un moteur de scoring IA via Supabase Edge Functions + Gemini.

## Architecture

```
Client React
  → Supabase Realtime (subscribe scores)
  
Supabase Edge Function: score-calculator
  ← Déclenché par: cron (15min) | trigger DB | appel manuel
  → Collecte données: zones + météo + événements
  → Appelle Gemini 2.5 Flash avec contexte
  → Parse le score JSON retourné
  → Upsert dans table scores
  → Realtime notifie le client
```

## Edge Function complète — score-calculator

```typescript
// supabase/functions/score-calculator/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { zone_ids, all_zones } = await req.json().catch(() => ({}))

    // 1. Récupérer les zones à scorer
    let zonesQuery = supabase.from('zones').select('*').eq('active', true)
    if (zone_ids?.length) zonesQuery = zonesQuery.in('id', zone_ids)
    const { data: zones, error: zonesError } = await zonesQuery
    if (zonesError) throw zonesError

    // 2. Récupérer la météo actuelle (Open-Meteo — gratuit)
    const weather = await getWeather(45.5017, -73.5673) // Montréal

    // 3. Récupérer les événements du jour (Ticketmaster)
    const events = await getEvents()

    // 4. Scorer chaque zone via Gemini
    const results = await Promise.all(
      zones.map(zone => scoreZone(zone, weather, events))
    )

    // 5. Upsert les scores dans Supabase
    const { error: upsertError } = await supabase
      .from('scores')
      .upsert(results, { onConflict: 'zone_id' })
    if (upsertError) throw upsertError

    return new Response(
      JSON.stringify({ success: true, scored: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function scoreZone(zone: any, weather: any, events: any[]) {
  const now = new Date()
  const hour = now.getHours()
  const dayOfWeek = now.getDay()

  const nearbyEvents = events.filter(e => {
    // Filtrer événements < 3km de la zone
    const dist = haversine(zone.lat, zone.lon, e.lat, e.lon)
    return dist < 3
  })

  const prompt = buildScoringPrompt(zone, hour, dayOfWeek, weather, nearbyEvents)
  const geminiScore = await callGemini(prompt)

  return {
    zone_id: zone.id,
    score: geminiScore.score,
    factors: geminiScore.factors,
    calculated_at: new Date().toISOString(),
  }
}

function buildScoringPrompt(zone: any, hour: number, dow: number, weather: any, events: any[]) {
  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
  
  return `Tu es un expert en optimisation de positionnement pour chauffeurs Lyft/taxi à Montréal.

Zone: ${zone.name} (${zone.territory})
Heure actuelle: ${hour}h (${dayNames[dow]})
Météo: ${weather.description}, ${weather.temp}°C, précipitations: ${weather.precip}mm
Événements à proximité (< 3km): ${events.length > 0 ? events.map(e => e.name).join(', ') : 'Aucun'}

Évalue la demande de courses dans cette zone sur une échelle de 0.0 à 10.0.

Réponds UNIQUEMENT en JSON valide, sans markdown:
{
  "score": <number 0.0-10.0>,
  "factors": {
    "time_of_day": <0.0-1.0>,
    "weather_impact": <0.0-1.0>,
    "events_impact": <0.0-1.0>,
    "day_type": <0.0-1.0>
  },
  "reasoning": "<explication courte en 1 phrase>"
}`
}

async function callGemini(prompt: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        }
      })
    }
  )
  
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  const text = data.candidates[0].content.parts[0].text
  return JSON.parse(text)
}

async function getWeather(lat: number, lon: number) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,weather_code&timezone=America%2FToronto`
  )
  const data = await res.json()
  return {
    temp: data.current.temperature_2m,
    precip: data.current.precipitation,
    code: data.current.weather_code,
    description: weatherCodeToDescription(data.current.weather_code)
  }
}

async function getEvents() {
  const key = Deno.env.get('TICKETMASTER_API_KEY')
  if (!key) return []
  
  const today = new Date().toISOString().slice(0, 19) + 'Z'
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 19) + 'Z'
  
  const res = await fetch(
    `https://app.ticketmaster.com/discovery/v2/events.json?` +
    `apikey=${key}&city=Montreal&countryCode=CA&startDateTime=${today}&endDateTime=${tomorrow}&size=20`
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data._embedded?.events ?? []).map((e: any) => ({
    name: e.name,
    lat: parseFloat(e._embedded?.venues?.[0]?.location?.latitude ?? '0'),
    lon: parseFloat(e._embedded?.venues?.[0]?.location?.longitude ?? '0'),
  }))
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function weatherCodeToDescription(code: number): string {
  if (code === 0) return 'Ciel clair'
  if (code <= 3) return 'Partiellement nuageux'
  if (code <= 49) return 'Brouillard'
  if (code <= 67) return 'Pluie'
  if (code <= 77) return 'Neige'
  if (code <= 82) return 'Averses'
  return 'Orage'
}
```

## Variables d'environnement requises

```bash
supabase secrets set GEMINI_API_KEY=AIzaXXXXX
supabase secrets set TICKETMASTER_API_KEY=XXXXXXX
# SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectés automatiquement
```

## Déploiement

```bash
supabase functions deploy score-calculator --no-verify-jwt
```

## Optimisation coût Gemini

```typescript
// Batching : scorer toutes les zones en un seul appel
const batchPrompt = zones.map(z => `Zone: ${z.name}`).join('\n')
// → Retourner un tableau JSON de scores
// Beaucoup moins cher que N appels individuels

// Cache : ne recalculer que si données ont changé
const lastScore = await supabase.from('scores')
  .select('calculated_at').eq('zone_id', zone.id).single()
const ageMin = (Date.now() - new Date(lastScore.calculated_at).getTime()) / 60000
if (ageMin < 14) return lastScore  // Skip si < 15 min
```
