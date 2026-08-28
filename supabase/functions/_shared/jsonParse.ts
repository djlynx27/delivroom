// Shared lenient JSON parser for Gemini responses across Edge Functions.
// Gemini's responseMimeType:'application/json' mostly returns clean JSON,
// but occasionally wraps it in markdown fences or trails extra prose --
// this recovers the JSON object in either case instead of throwing.

/**
 * Attempts, in order:
 * 1. Strict JSON.parse
 * 2. Strip ```json ... ``` / ``` ... ``` fences
 * 3. Find the first balanced { ... } block via brace counting
 * Returns null if none of the above yields valid JSON.
 */
export function lenientJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
