import { readFileSync } from 'fs';

function parseCSV(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
      } else if (ch === ',' && !q) {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

const rows = parseCSV(
  readFileSync(
    'D:/Documents/Base de données pour mon appli Delivroom/QuickBooks_Mileage.csv',
    'utf-8'
  )
);
const data = rows.slice(1).filter((r) => r[0] && r[0] !== 'Date');

const byDate = {};
for (const r of data) {
  const d = r[0].trim();
  const km = parseFloat(r[6]) || 0;
  if (!byDate[d]) byDate[d] = { trips: 0, km: 0 };
  byDate[d].trips++;
  byDate[d].km += km;
}

const totalKm = data.reduce((s, r) => s + (parseFloat(r[6]) || 0), 0);
console.log(
  `Trips: ${data.length} | Total km: ${totalKm.toFixed(1)} | Avg: ${(totalKm / data.length).toFixed(1)} km/trip`
);
console.log(`Days active: ${Object.keys(byDate).length}`);

let maxKm = 0,
  maxDay = '',
  maxTrips = 0,
  maxTripsDay = '';
for (const [d, v] of Object.entries(byDate)) {
  if (v.km > maxKm) {
    maxKm = v.km;
    maxDay = d;
  }
  if (v.trips > maxTrips) {
    maxTrips = v.trips;
    maxTripsDay = d;
  }
}
console.log(`Best km day: ${maxDay} → ${maxKm.toFixed(1)} km`);
console.log(`Most trips day: ${maxTripsDay} → ${maxTrips} trips`);
console.log('\nDaily breakdown:');
for (const [d, v] of Object.entries(byDate).sort()) {
  console.log(`  ${d}: ${v.trips} trips, ${v.km.toFixed(1)} km`);
}
