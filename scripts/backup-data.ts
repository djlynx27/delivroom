/**
 * Export JSON de toutes les tables `public` (plan Free = pas de backups auto).
 * Dossier backups/<horodatage>/<table>.json. Le schéma vit déjà dans supabase/migrations/.
 *
 * Usage : npm run backup:db
 * Requiert dans .env.local : VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (local seulement,
 * jamais côté client). Tables découvertes via l'OpenAPI de PostgREST, rien de codé en dur.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = 1000

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env.local')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function listTables(): Promise<string[]> {
  const res = await fetch(`${url}/rest/v1/`, { headers })
  if (!res.ok) throw new Error(`OpenAPI ${res.status}`)
  const spec: unknown = await res.json()
  const defs =
    typeof spec === 'object' && spec !== null && 'definitions' in spec
      ? (spec as { definitions: Record<string, unknown> }).definitions
      : {}
  return Object.keys(defs)
}

async function dumpTable(table: string): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    })
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`)
    const batch: unknown = await res.json()
    if (!Array.isArray(batch)) throw new Error(`${table}: réponse inattendue`)
    rows.push(...batch)
    if (batch.length < PAGE) return rows
  }
}

async function main(): Promise<void> {
  const dir = join('backups', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const failed: string[] = []
  for (const table of await listTables()) {
    try {
      const rows = await dumpTable(table)
      writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows))
      console.log(`${table}: ${rows.length}`)
    } catch (err) {
      failed.push(table)
      console.error(err instanceof Error ? err.message : err)
    }
  }
  console.log(`-> ${dir}`)
  if (failed.length) {
    console.error(`ÉCHEC: ${failed.join(', ')}`)
    process.exit(1)
  }
}

void main()
