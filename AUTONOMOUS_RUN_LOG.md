# Run log — 401 "Authentification requise" investigation (2026-09-20)

Status: **client-side issue resolved, blocked on Supabase-side DB contention**.

## Timeline

1. `df76d3d`/`64e02b5` — cache-first cold start + stale-cache nav guard (unrelated feature work, same session).
2. `9192a31` — replaced per-file `supabase.auth.getUser()` (network round-trip) with `getSession()` in the bulk upload path. Real fix, but not the on-device failure's actual cause.
3. `1c77bda` — `ensureAuthSession()`: fixed a genuine startup race between `useAnonAuth`'s background sign-in and a batch started right after app launch. Also not the full story.
4. `0c261b8` — added diagnostic logging (no fix) after two rounds of hypothesis-driven fixes didn't fully resolve the on-device report.
5. **On-device logcat capture** (S23 Ultra) showed `signInAnonymously()` aborting at the client's own 15s timeout, repeatedly, for 8+ minutes — `5b74346` raised the auth-specific timeout to 30s.
6. Still failing. **CDP network capture** proved the request got zero bytes back for a full 30s — then a direct `curl` from a different machine/network entirely reproduced the same zero-byte 40s+ hang, ruling out the device/WebView/client code as the cause.
7. **Live Supabase-side audit** (via the project's own dashboard assistant) confirmed the root cause: intermittent PgBouncer/Postgres contention from unrelated background dashboard/advisor queries, causing GoTrue to return HTTP 504 on `/signup` and `/token` for ~12-50s at a stretch. Not RLS, not `verify_jwt` (already `false` on `analyze-screenshot`), not a permanent outage.
8. `b613f33` — `AUTH_REQUEST_TIMEOUT_MS` raised to 60s + bounded retry (2 attempts, 5s/10s backoff) in `ensureAuthSession()` to ride out one contention window.

## Result on retest (S23 Ultra, build `b613f33`)

- ✅ "Authentification requise" (401) is **gone** — session establishes correctly.
- ⚠️ New, different error surfaces on the actual data-write calls: **"The connection to the database timed out."** Same underlying PgBouncer/Postgres contention the audit identified, now visible one layer further in (auth is no longer the first thing it blocks).

## What's left

Nothing on the client side to fix right now. The batch will proceed once Supabase's DB contention clears. If this persists:
- Re-check Supabase dashboard → Logs → Database / Auth, or re-run the project audit.
- Do not add more client-side timeout/retry tuning without fresh evidence — the current bounds (60s auth timeout, 15s storage/functions timeout, 2 retries) were sized directly off the audit's own reported 12-50s contention window.
