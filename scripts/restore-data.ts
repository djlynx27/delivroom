/**
 * Restaure un dossier produit par backup-data.ts (upsert par clé primaire, par lots de 500).
 * Ordre des FK inconnu : on passe plusieurs fois, les tables en échec sont retentées tant
 * qu'au moins une passe progresse. Le reste est signalé et le script sort en code 1.
 *
 * Usage : npm run restore:db -- backups/<horodatage>
 * ATTENTION : écrase les lignes existantes de même clé primaire (service_role, contourne la RLS).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const BATCH = 500

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dir = process.argv[2]
if (!url || !key || !dir) {
  console.error('Usage: npm run restore:db -- backups/<dossier> (+ .env.local avec URL et service_role)')
  process.exit(1)
}

async function upsert(table: string, rows: unknown[]): Promise<string | null> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: {
        apikey: key as string,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    })
    if (!res.ok) return `${res.status} ${await res.text()}`
  }
  return null
}

async function main(): Promise<void> {
  let pending = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))
  const errors = new Map<string, string>()

  while (pending.length) {
    const next: string[] = []
    for (const table of pending) {
      const rows: unknown = JSON.parse(readFileSync(join(dir, `${table}.json`), 'utf-8'))
      if (!Array.isArray(rows) || rows.length === 0) continue
      const err = await upsert(table, rows)
      if (err) {
        errors.set(table, err)
        next.push(table)
      } else {
        errors.delete(table)
        console.log(`${table}: ${rows.length}`)
      }
    }
    if (next.length === pending.length) break // aucune progression
    pending = next
  }

  for (const [table, err] of errors) console.error(`ÉCHEC ${table}: ${err}`)
  if (errors.size) process.exit(1)
}

void main()
