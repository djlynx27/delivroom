---
name: typescript-strict
description: Typage TypeScript avancé — generics, discriminated unions, utility types, type guards, inférence avancée. Utilise ce skill dès que l'utilisateur travaille sur du code TypeScript complexe, demande comment typer correctement une structure, veut éliminer des `any`, ou a des erreurs de type difficiles à résoudre dans un projet React/Vite/TypeScript comme Delivroom.
---

# TypeScript Strict

Typage avancé TypeScript pour projets React + Supabase.

## Config recommandée (tsconfig.json)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Types fondamentaux — Delivroom

```typescript
// types/index.ts

export type Territory = 'montreal' | 'laval' | 'longueuil'
export type Platform = 'lyft' | 'doordash' | 'skip' | 'hypra' | 'uber'
export type DemandLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

export interface Zone {
  id: string
  name: string
  territory: Territory
  lat: number
  lon: number
  active: boolean
  created_at: string
}

export interface ZoneScore {
  zone_id: string
  score: number  // 0.0 – 10.0
  factors: ScoreFactors
  calculated_at: string
}

export interface ScoreFactors {
  time_of_day: number
  weather_impact: number
  events_impact: number
  day_type: number
}

// Discriminated union pour les états de chargement
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }
```

## Generics

```typescript
// Hook générique pour les requêtes Supabase
function useSupabaseQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: Error | null }>
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' })
  
  useEffect(() => {
    setState({ status: 'loading' })
    queryFn().then(({ data, error }) => {
      if (error) setState({ status: 'error', error: error.message })
      else if (data) setState({ status: 'success', data })
    })
  }, [])
  
  return state
}

// Utility type : rendre certains champs optionnels
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// Zone sans id (pour la création)
type ZoneInsert = PartialBy<Zone, 'id' | 'created_at'>
```

## Type Guards

```typescript
// Vérifier qu'une valeur est un ZoneScore valide
function isZoneScore(value: unknown): value is ZoneScore {
  return (
    typeof value === 'object' &&
    value !== null &&
    'zone_id' in value &&
    'score' in value &&
    typeof (value as ZoneScore).score === 'number'
  )
}

// Guard pour les réponses API
function assertDefined<T>(value: T | null | undefined, msg: string): T {
  if (value == null) throw new Error(msg)
  return value
}
```

## Utility Types courants

```typescript
// Types de base
type Readonly<T>            // Toutes les propriétés readonly
type Partial<T>             // Toutes optionnelles
type Required<T>            // Toutes obligatoires
type Pick<T, K>             // Sélectionner des clés
type Omit<T, K>             // Exclure des clés
type Record<K, V>           // Dictionnaire
type Exclude<T, U>          // Exclure de l'union
type Extract<T, U>          // Garder de l'union
type NonNullable<T>         // Exclure null et undefined
type ReturnType<F>          // Type de retour d'une fonction
type Parameters<F>          // Types des paramètres
type Awaited<T>             // Type résolu d'une Promise

// Exemples pratiques
type ZoneId = Zone['id']                        // string
type UpdateZone = Partial<Pick<Zone, 'name' | 'active'>>
type ScoreFactor = keyof ScoreFactors           // 'time_of_day' | ...
type FactorValue = ScoreFactors[ScoreFactor]    // number
```

## Supprimer les `any`

```typescript
// ❌ Mauvais
const data: any = await fetch('/api/zones').then(r => r.json())

// ✅ Bon — avec validation runtime
async function fetchZones(): Promise<Zone[]> {
  const res = await fetch('/api/zones')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data: unknown = await res.json()
  
  if (!Array.isArray(data)) throw new Error('Expected array')
  return data.filter(isZoneScore)  // Type guard
}

// ✅ Bon — avec Zod (validation + inférence)
import { z } from 'zod'

const ZoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  territory: z.enum(['montreal', 'laval', 'longueuil']),
  score: z.number().min(0).max(10),
})

type Zone = z.infer<typeof ZoneSchema>  // Type auto-généré

const parsed = ZoneSchema.safeParse(rawData)
if (parsed.success) console.log(parsed.data.score)
```

## Template literals

```typescript
type EventType = 'INSERT' | 'UPDATE' | 'DELETE'
type TableName = 'zones' | 'scores' | 'events'

// Générer des types de canaux Supabase
type RealtimeChannel = `${TableName}:${EventType}`
// = "zones:INSERT" | "zones:UPDATE" | ... (9 combinaisons)

// Route type-safe
type Route = '/dashboard' | '/map' | `/zone/${string}` | `/zone/${string}/history`
```

## Erreurs TypeScript fréquentes et solutions

| Erreur | Solution |
|---|---|
| `Object is possibly 'undefined'` | Optional chaining `?.` ou guard explicite |
| `Type 'string' is not assignable to 'Territory'` | Cast `as Territory` (si certain) ou Zod |
| `Property X does not exist on type Y` | Vérifier le type avec `typeof` ou discriminated union |
| `No overload matches this call` | Vérifier les paramètres — souvent un type mal inféré |
| `Index signature is missing` | `Record<string, T>` plutôt qu'objet littéral |
