---
name: api-integrator
description: Connexion, wrapping et intégration d'APIs REST/GraphQL tierces dans des projets TypeScript/React. Utilise ce skill dès que l'utilisateur veut connecter une API externe (Ticketmaster, Open-Meteo, Google Maps, Mapbox, Twilio, etc.), créer un wrapper typé, gérer l'authentification API, ou déboguer des appels API. Priorité aux APIs utilisées dans Delivroom.
---

# API Integrator

Intégration propre d'APIs externes dans un projet TypeScript/React.

## APIs prioritaires (Delivroom)

| API | Usage | Auth |
|---|---|---|
| **Open-Meteo** | Météo (gratuit, sans clé) | Aucune |
| **Ticketmaster Discovery** | Événements Montréal | API Key |
| **Mapbox** | Cartes, geocoding, routes | Access Token |
| **Google Maps Platform** | Places, Directions | API Key |
| **Gemini** | Scoring IA | API Key (via Edge Function) |

## Pattern de base — Wrapper typé

```typescript
// lib/api/openMeteo.ts
const BASE_URL = 'https://api.open-meteo.com/v1'

export interface WeatherData {
  current: {
    temperature_2m: number
    precipitation: number
    weather_code: number
    wind_speed_10m: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
  }
}

export async function getWeather(lat: number, lon: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability',
    timezone: 'America/Toronto',
    forecast_days: '1',
  })

  const res = await fetch(`${BASE_URL}/forecast?${params}`)
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)
  return res.json()
}
```

## Pattern avec cache + retry

```typescript
// lib/api/client.ts
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class ApiClient {
  private cache = new Map<string, CacheEntry<unknown>>()

  async fetch<T>(
    url: string,
    options: RequestInit & { ttl?: number; retries?: number } = {}
  ): Promise<T> {
    const { ttl = 300, retries = 3, ...fetchOptions } = options
    const cacheKey = url + JSON.stringify(fetchOptions.body)

    // Vérifier le cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < cached.ttl * 1000) {
      return cached.data as T
    }

    // Retry avec backoff exponentiel
    let lastError: Error
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, fetchOptions)
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        const data = await res.json() as T
        this.cache.set(cacheKey, { data, timestamp: Date.now(), ttl })
        return data
      } catch (err) {
        lastError = err as Error
        if (i < retries - 1) await new Promise(r => setTimeout(r, 2 ** i * 1000))
      }
    }
    throw lastError!
  }
}

export const apiClient = new ApiClient()
```

## Ticketmaster Discovery API

```typescript
// lib/api/ticketmaster.ts
const TM_BASE = 'https://app.ticketmaster.com/discovery/v2'

export interface TMEvent {
  id: string
  name: string
  dates: { start: { dateTime: string } }
  _embedded?: {
    venues: Array<{ name: string; location: { latitude: string; longitude: string } }>
  }
  classifications?: Array<{ genre: { name: string } }>
}

export async function getMontrealEvents(daysAhead = 1): Promise<TMEvent[]> {
  const startDate = new Date().toISOString().slice(0, 19) + 'Z'
  const endDate = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 19) + 'Z'

  const params = new URLSearchParams({
    apikey: import.meta.env.VITE_TICKETMASTER_KEY,
    city: 'Montreal',
    countryCode: 'CA',
    startDateTime: startDate,
    endDateTime: endDate,
    size: '50',
    sort: 'date,asc',
  })

  const res = await apiClient.fetch<{ _embedded?: { events: TMEvent[] } }>(
    `${TM_BASE}/events.json?${params}`,
    { ttl: 1800 } // Cache 30 min
  )

  return res._embedded?.events ?? []
}
```

## Gestion des clés API

### Variables d'environnement Vite

```bash
# .env.local (jamais commité)
VITE_TICKETMASTER_KEY=xxxxx
VITE_MAPBOX_TOKEN=pk.xxxxx
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxxx

# .env.example (commité, sans valeurs)
VITE_TICKETMASTER_KEY=
VITE_MAPBOX_TOKEN=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

### Via Supabase Edge Functions (pour clés sensibles)

```typescript
// Côté Edge Function — jamais exposer côté client
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
const TM_KEY = Deno.env.get('TICKETMASTER_SECRET_KEY')
```

## Mapbox — Carte + Géocodage

```typescript
import mapboxgl from 'mapbox-gl'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Géocodage d'adresse
export async function geocode(address: string) {
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json` +
    `?access_token=${mapboxgl.accessToken}&country=CA&language=fr`
  )
  const data = await res.json()
  return data.features[0]?.center // [lng, lat]
}
```

## Débogage API — Checklist

```
□ Status code vérifié (200, 401, 429, 500)
□ Headers Content-Type corrects
□ CORS : ajouter proxy Vite si nécessaire
□ Rate limiting : vérifier les headers X-RateLimit-*
□ Clé API correcte (dev vs prod)
□ Paramètres encodés (URLSearchParams)
□ Timeout : ajouter AbortController si >5s
```

## Proxy Vite (contourner CORS en dev)

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api/ticketmaster': {
      target: 'https://app.ticketmaster.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/ticketmaster/, '/discovery/v2'),
    },
  },
},
```
