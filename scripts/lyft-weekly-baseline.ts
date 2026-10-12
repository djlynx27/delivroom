/**
 * Base de chiffres Lyft à partir des relevés hebdomadaires (lyft_weekly_summary.json).
 * Lecture seule, aucune dépendance, aucune base de données.
 *
 * Usage :
 *   npx tsx scripts/lyft-weekly-baseline.ts [--file <chemin.json>] [--l100 12] [--fuel 1.55] [--json]
 *
 * Carburant (2 bornes, car le compteur n'est pas connu) :
 *   bas  = km « réservés » Lyft seulement (aucun roulage à vide)
 *   haut = km réservés × (heures en ligne / heures en course), hypothèse : km proportionnels au temps
 * Deux « nets » :
 *   avec taxes = Total earnings Lyft - carburant
 *   hors taxes = (Total earnings - TPS/TVQ perçues des passagers) - carburant
 * La TPS/TVQ perçue est à remettre : ce n'est pas du revenu. Aucune autre charge n'est déduite
 * (assurance perso, entretien, dépréciation, impôt).
 */
import { readFileSync } from 'node:fs'

const DEFAULT_FILE =
  'D:\\Documents\\Claude Projects\\Coach Financier\\Lyft Weekly Reports\\lyft_weekly_summary.json'

interface Week {
  weekStart: string
  onlineH: number
  bookedH: number
  rides: number
  distanceKm: number
  net: number
  gross: number
  tips: number
  bonuses: number
  taxes: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function num(r: Record<string, unknown>, key: string, required: boolean): number {
  const v = r[key]
  if (v === null || v === undefined) {
    if (required) throw new Error(`champ manquant : ${key}`)
    return 0
  }
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`champ non numérique : ${key}`)
  return n
}

function parseWeeks(raw: unknown): Week[] {
  if (!isRecord(raw) || !Array.isArray(raw.weeks)) throw new Error('Format invalide : { "weeks": [...] } attendu')
  return raw.weeks.map((w: unknown, i: number) => {
    if (!isRecord(w) || typeof w.week_start !== 'string') throw new Error(`weeks[${i}] : week_start manquant`)
    try {
      const week: Week = {
        weekStart: w.week_start,
        onlineH: num(w, 'online_h', true),
        bookedH: num(w, 'booked_h', true),
        rides: num(w, 'rides', true),
        distanceKm: num(w, 'distance_km', true),
        net: num(w, 'total_earnings_net', true),
        gross: num(w, 'earnings_gross', true),
        tips: num(w, 'tips', false),
        bonuses: num(w, 'bonuses', false),
        taxes: num(w, 'tax_passthrough_gst_qst', false),
      }
      if (week.onlineH <= 0 || week.bookedH <= 0) throw new Error('heures <= 0')
      return week
    } catch (e) {
      throw new Error(`weeks[${i}] (${w.week_start}) : ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function positiveArg(flag: string, fallback: number): number {
  const n = Number(argValue(flag, String(fallback)))
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} doit être un nombre > 0`)
  return n
}

const r2 = (n: number): number => Math.round(n * 100) / 100

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function main(): void {
  const l100 = positiveArg('--l100', 12)
  const price = positiveArg('--fuel', 1.55)
  const perKm = (l100 * price) / 100
  const weeks = parseWeeks(JSON.parse(readFileSync(argValue('--file', DEFAULT_FILE), 'utf-8')) as unknown)

  const rows = weeks.map((w) => {
    const kmHigh = (w.distanceKm * w.onlineH) / w.bookedH
    const fuelLow = w.distanceKm * perKm
    const fuelHigh = kmHigh * perKm
    const netExTax = w.net - w.taxes
    return {
      weekStart: w.weekStart,
      onlineH: w.onlineH,
      rides: w.rides,
      efficiency: w.bookedH / w.onlineH,
      netPerH: w.net / w.onlineH,
      exTaxPerH: netExTax / w.onlineH,
      fuelLow,
      fuelHigh,
      withTaxFuelHighPerH: (w.net - fuelHigh) / w.onlineH,
      withTaxFuelLowPerH: (w.net - fuelLow) / w.onlineH,
      exTaxFuelHighPerH: (netExTax - fuelHigh) / w.onlineH,
      exTaxFuelLowPerH: (netExTax - fuelLow) / w.onlineH,
    }
  })

  const sum = (f: (w: Week) => number): number => weeks.reduce((s, w) => s + f(w), 0)
  const hours = sum((w) => w.onlineH)
  const booked = sum((w) => w.bookedH)
  const net = sum((w) => w.net)
  const taxes = sum((w) => w.taxes)
  const km = sum((w) => w.distanceKm)
  const fuelLow = km * perKm
  const fuelHigh = rows.reduce((s, r) => s + r.fuelHigh, 0)

  const totals = {
    weeks: weeks.length,
    rides: sum((w) => w.rides),
    onlineHours: r2(hours),
    bookedHours: r2(booked),
    efficiency: Math.round((booked / hours) * 1000) / 1000,
    bookedKm: r2(km),
    estimatedTotalKm: r2(km * (hours / booked)),
    netEarnings: r2(net),
    grossEarnings: r2(sum((w) => w.gross)),
    tips: r2(sum((w) => w.tips)),
    bonuses: r2(sum((w) => w.bonuses)),
    taxesCollected: r2(taxes),
    fuelPerKm: r2(perKm * 1000) / 1000,
    fuelLow: r2(fuelLow),
    fuelHigh: r2(fuelHigh),
    perOnlineHour: {
      net: r2(net / hours),
      netExTax: r2((net - taxes) / hours),
      netMinusFuel: { high: r2((net - fuelLow) / hours), low: r2((net - fuelHigh) / hours) },
      netExTaxMinusFuel: { high: r2((net - taxes - fuelLow) / hours), low: r2((net - taxes - fuelHigh) / hours) },
    },
    weeklyMedianNetPerHour: r2(median(rows.map((r) => r.netPerH))),
    avgNetPerWeek: r2(net / weeks.length),
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ assumptions: { l100, price }, totals, weeks: rows.map((r) => ({ ...r })) }, null, 2))
    return
  }

  const f = (n: number, w = 6): string => n.toFixed(1).padStart(w)
  console.log(`Carburant : ${l100} L/100 km × ${price} $/L = ${perKm.toFixed(3)} $/km  |  ${weeks.length} semaines\n`)
  console.log('Semaine     Heures Courses Effic. Net/h  HorsTx/h  Net-carb/h(bas-haut)  HorsTx-carb/h(bas-haut)')
  for (const r of rows) {
    console.log(
      `${r.weekStart} ${f(r.onlineH, 7)} ${String(r.rides).padStart(7)} ${(r.efficiency * 100).toFixed(0).padStart(5)}% ` +
        `${f(r.netPerH)} ${f(r.exTaxPerH, 8)}   ${f(r.withTaxFuelHighPerH)} - ${f(r.withTaxFuelLowPerH)}` +
        `        ${f(r.exTaxFuelHighPerH)} - ${f(r.exTaxFuelLowPerH)}`,
    )
  }
  const p = totals.perOnlineHour
  console.log(`\nTOTAL : ${hours.toFixed(1)} h en ligne, ${totals.rides} courses, efficacité ${(totals.efficiency * 100).toFixed(1)} %`)
  console.log(`  Net Lyft ${totals.netEarnings} $ | taxes perçues ${totals.taxesCollected} $ | pourboires ${totals.tips} $ | bonus ${totals.bonuses} $`)
  console.log(`  Km : ${totals.bookedKm} réservés, ~${totals.estimatedTotalKm} estimés avec roulage à vide`)
  console.log(`  Carburant : ${totals.fuelLow} $ (bas) à ${totals.fuelHigh} $ (haut)`)
  console.log(`  $/h en ligne : net ${p.net} | hors taxes ${p.netExTax}`)
  console.log(`  $/h net de carburant, AVEC taxes : ${p.netMinusFuel.low} à ${p.netMinusFuel.high}`)
  console.log(`  $/h net de carburant, HORS taxes : ${p.netExTaxMinusFuel.low} à ${p.netExTaxMinusFuel.high}  <- le plus prudent`)
  console.log(`  Médiane hebdo $/h net : ${totals.weeklyMedianNetPerHour} | moyenne nette/semaine : ${totals.avgNetPerWeek} $`)
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
