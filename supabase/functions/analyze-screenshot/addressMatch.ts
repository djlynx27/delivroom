// Pure address -> zone matching for analyze-screenshot, split out from index.ts
// so it is testable via `deno test` without binding index.ts's serve() listener
// (same pattern as autoSave.ts / preAnalyzed.ts).

export interface MatchableZone {
  id: string;
  name: string;
  city_id: string | null;
}

const CITY_KEYWORDS: Record<string, string[]> = {
  mtl: [
    'montreal', 'montréal', 'mtl',
    'saint-laurent', 'st-laurent', 'st laurent', 'saint laurent',
    'saint-léonard', 'st-léonard', 'saint leonard', 'st leonard',
    'verdun', 'outremont', 'westmount', 'lasalle', 'anjou',
    'rivière-des-prairies', 'riviere-des-prairies', 'rdp',
    'pointe-aux-trembles', 'pat',
    'plateau', 'rosemont', 'villeray', 'parc-extension', 'parc ex',
    'mile end', 'mile-end', 'côte-des-neiges', 'cote-des-neiges', 'cdn',
    'notre-dame-de-grâce', 'ndg',
    'hochelaga', 'maisonneuve', 'mercier', 'ahuntsic', 'cartierville',
    'lachine', 'dorval', 'pierrefonds', 'roxboro', 'kirkland',
    'pointe-claire', 'baie-d\'urfé', 'beaconsfield', 'sainte-anne-de-bellevue',
    'griffintown', 'sud-ouest', 'sud ouest',
  ],
  lvl: ['laval', 'chomedey', 'sainte-rose', 'ste-rose', 'sainte-dorothée',
    'duvernay', 'fabreville', 'auteuil', 'pont-viau', 'vimont', 'laval-ouest',
    'laval-des-rapides', 'saint-vincent-de-paul', 'saint-françois'],
  lng: ['longueuil', 'brossard', 'saint-hubert', 'st-hubert', 'saint-lambert',
    'st-lambert', 'greenfield park', 'lemoyne', 'boucherville',
    'saint-bruno', 'st-bruno', 'rive-sud', 'rive sud', 'south shore'],
  trb: ['terrebonne', 'lachenaie', 'mascouche', 'la plaine'],
  sth: ['sainte-thérèse', 'ste-thérèse', 'ste therese'],
  blv: ['blainville'],
  bsb: ['boisbriand'],
  rsm: ['rosemère', 'rosemere'],
  bdf: ['bois-des-filion', 'bois des filion'],
};

export function guessCityId(address: string): string | null {
  const lower = address.toLowerCase();
  // Score each city by counting keyword hits; pick the highest
  let bestCity: string | null = null;
  let bestScore = 0;
  for (const [cityId, keywords] of Object.entries(CITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > bestScore) {
        bestCity = cityId;
        bestScore = kw.length;
      }
    }
  }
  return bestCity;
}

export function fuzzyMatchAddress<Z extends MatchableZone>(address: string, zones: Z[]): Z | null {
  const cityId = guessCityId(address);
  const candidates = cityId ? zones.filter((z) => z.city_id === cityId) : zones;
  if (!candidates.length) return null;

  // Strip the trailing city tag so "Boulevard X, Laval" doesn't make every Laval
  // zone match on the word "laval"
  const street = stripCityTag(address).toLowerCase();

  // Score each candidate zone by how many of its name tokens appear in the address.
  // Longer matched tokens score higher.
  let best: Z | null = null;
  let bestScore = 0;
  for (const zone of candidates) {
    const score = scoreZoneAgainstAddress(zone.name, street);
    if (score > bestScore) {
      best = zone;
      bestScore = score;
    }
  }
  // Require a meaningful match (at least one ≥4-char token hit) to avoid false positives
  return bestScore >= 4 ? best : null;
}

const CITY_TAG_RE = /,\s*(?:laval|longueuil|montréal|montreal|mtl|terrebonne|blainville|boisbriand|rosemère|rosemere|bois-des-filion|sainte-thérèse|ste-thérèse|ste thérèse|mont-royal|qc|québec|quebec|canada)[\s,]*$/iu;

function stripCityTag(address: string): string {
  return address.replace(CITY_TAG_RE, '').trim();
}

function scoreZoneAgainstAddress(zoneName: string, lowerAddress: string): number {
  const tokens = zoneName
    .toLowerCase()
    .split(/[\s\-']+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  // Whole-word comparison, not substring: "mont" (from "Avenue Mont-Royal") must not
  // hit "Lamont", "Montcalm", "Beaumont", "Outremont" or "Rosemont" — that made the
  // Mont-Royal zone swallow 16 of 291 unrelated pickups.
  const words = new Set(lowerAddress.split(/[^\p{L}\p{N}]+/u));
  let score = 0;
  for (const token of tokens) {
    if (words.has(token)) {
      score += token.length;
    }
  }
  return score;
}

const STOPWORDS = new Set([
  'rue', 'boul', 'boulevard', 'bd', 'avenue', 'av', 'place', 'gare',
  'station', 'centre', 'ville', 'sainte', 'saint', 'ste', 'st', 'de',
  'la', 'le', 'les', 'du', 'des', 'cégep', 'cegep', 'parc',
  // City names: discovered zones are named after their address ("... , Montréal"),
  // so the city word would otherwise match any address that mentions the city.
  'montréal', 'montreal', 'laval', 'longueuil', 'terrebonne', 'blainville',
]);
