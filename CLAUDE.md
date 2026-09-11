# CLAUDE.md — Delivroom

Ce fichier est lu automatiquement par Claude Code à chaque session.

---

## Contexte projet

**App :** Delivroom (anciennement HustleGo, renommé 2026-05-21)
**Repo :** github.com/djlynx27/delivroom
**Stack :** React 19 + Vite 7 + TypeScript 5.9 strict + Tailwind 3.4 + Supabase
**Hosting :** Vercel (project `delivroom`, team `djlynx27s-projects`)
**Mobile :** Capacitor 8 (Android) + TWA (PWA installable)
**Tests :** Vitest 4 + Playwright 1.58
**Umbrella business :** Hustle Go Media — Delivroom est UN des side hustles, ne pas mélanger les deux contextes

### Territoires

Montréal, Laval, Longueuil/Rive-Sud, Rive-Nord (Terrebonne, Blainville,
Repentigny/Rosemère, Sainte-Thérèse), Boucherville — **70 zones** en DB
(vérifié 2026-09-11 via `list_tables`/`execute_sql`, corrige l'ancien
chiffre de 61 qui datait). Répartition : mtl 28, lvl 14, lng 13, trb 5,
blv/rsm/sth 3 chacune, bsb 1 (Boucherville — un seul point pour toute la
ville, densité la plus faible du dataset avec Longueuil qui a le plus
grand écart moyen entre zones, ~2.9km).

**Architecture spatiale — pas de PostGIS.** `zones` n'a que
`latitude`/`longitude` (un point par zone), aucune colonne géométrie et
l'extension `postgis` n'est pas installée sur le projet Supabase (visible
dans `list_extensions`, `installed_version: null`). La résolution
"quelle zone" se fait **côté client**, par plus-proche-voisin (Haversine),
voir `haversineKm`/`haversineMeters` dans `useUserLocation.ts` et
`scripts/lib/geo.ts`. Conséquence : pas de "trou de geofence" possible au
sens polygone — chaque point du globe a toujours une zone "la plus
proche" — donc tout lookup nearest-neighbor doit avoir un plafond de
distance explicite pour éviter un faux match lointain (`MAX_GPS_ZONE_KM`
dans `tripSave.ts` = 25km, réutilisé par `findNearestZone` dans
`useNotifications.ts`). N'importe quel futur nearest-neighbor sur `zones`
doit suivre ce pattern plutôt que ré-introduire un lookup sans plafond.

### Plateformes chauffeur

Lyft, Hypra (Taxi Express Plan F), Imoove

### IDs externes (immuables — ne pas modifier)

| Service | ID |
|---|---|
| Supabase project ref | `hibzhsjgipybfihhzpxr` (name: Delivroom, region ca-central-1) |
| Vercel project ID | `prj_79tYnjLTxeNdp7Uher6cRv2oyCLX` |
| Vercel team ID | `team_qGbQ44wwG6Kp3KR1OFOAwlgD` |
| Android appId | `com.delivroom.app` |
| TWA packageId | `app.delivroom.driver` |

### Tables Supabase

Toutes avec RLS activé (non-négociable). Liste à jour : `list_tables` MCP ou `supabase/migrations/`.

### Edge Functions

Voir `supabase/functions/` pour la liste à jour (une fonction = un sous-dossier).

### Migrations

Versionnées dans `supabase/migrations/` — voir le dossier pour la liste et le statut à jour.

---

## Conventions de code

- TypeScript **strict** — zero `any`, zero `as any`, `unknown` + type guard à la place
- Named exports uniquement, jamais de `default export`
- `as const` > enums
- Commits conventional : `feat(scope):` / `fix(scope):` / `chore(scope):` / `refactor(scope):` / `docs(scope):` — en anglais
- Branches : `feature/xxx`, `fix/xxx`, `hotfix/xxx`, `chore/xxx`
- Format Prettier : 2 espaces, pas de semi, single quotes

---

## Anti-patterns interdits

- `any` TypeScript → `unknown` + type guard / Zod
- `useEffect` sans cleanup sur subscriptions Supabase
- Clés API sensibles côté client (Gemini, service_role) — Edge Functions only
- Edge Functions sans handler `OPTIONS` + `corsHeaders` + try/catch
- Score Gemini sans validation JSON stricte
- `git push --no-verify` sauf urgence documentée
- Modifier code hors scope — `// FIXME(claude): description` à la place
- Migrations SQL modifiées après application sur prod

---

## Skills actifs (`.claude/skills/`)

`supabase-expert`, `ai-scoring-engine`, `demand-forecaster`, `react-native-pwa`, `typescript-strict`, `api-integrator`, `map-visualizer`, `surge-engine`, `git-workflow`, `shift-planner`

Lire le `SKILL.md` correspondant pour le détail. Note : ces skills sont post-rename Delivroom mais peuvent référencer des concepts hérités du nom HustleGo dans certaines descriptions.

---

## Device Android (MacroDroid, PWA native)

Règle ADB Wireless Debugging (S23 Ultra / Pixel 8) — voir §14 du `CLAUDE.md`
global (`~/.claude/CLAUDE.md`), pas dupliquée ici. En bref : tâche
macro/PWA/native sur ces devices → `adb devices` d'abord, puis demander le
code d'appairage si aucune session active, ne pas s'arrêter à des
instructions manuelles non testées.

### Topologie réelle sur le S23 Ultra (vérifiée par ADB 2026-09-05)

⚠️ Les IDs du tableau « IDs externes » plus haut (`com.delivroom.app`
Capacitor, `app.delivroom.driver` TWA) ne sont **pas installés** sur
l'appareil. Delivroom y tourne comme **WebAPK Chrome** :

| Rôle | Package réel |
|---|---|
| Delivroom (PWA) | `org.chromium.webapk.a723e1524e8ac6908_v2` (host: `com.android.chrome`) |
| MacroDroid | `com.arlosoft.macrodroid` |
| **Maxymo** | `com.tech.gm.pegasusdriver` (nom trompeur — c'est bien Maxymo) |
| Lyft Driver | `com.lyft.android.driver` |

Conséquence pratique : le Service Worker et le cache de Delivroom vivent dans
le stockage **de Chrome**, pas dans le package WebAPK. Un `pm clear` sur le
WebAPK ne nettoie donc **rien** du SW ; et `pm clear com.android.chrome`
détruirait toute la session Supabase + la config auto-scan Maxymo. Pour
buster un build périmé, passer par CDP (`adb forward tcp:9222
localabstract:chrome_devtools_remote`) et poster `{type:'SKIP_WAITING'}` au
SW en attente — non destructif, préserve auth/localStorage/IndexedDB.

Le device a aussi un profil **Secure Folder (user 150)** : les commandes `pm`
renvoient une `SecurityException` sur cet utilisateur, c'est normal et sans
impact sur l'audit de l'utilisateur 0.

---

## Commandes fréquentes

```powershell
# Dev
npm run dev
supabase functions serve score-calculator

# Validation pré-commit
npm run type-check
npm run lint
npm run test:run

# Deploy Edge Function
supabase functions deploy score-calculator --no-verify-jwt
supabase secrets set GEMINI_API_KEY=xxx

# E2E
npm run test:e2e

# Android
npx cap sync android
```

---

## Architecture — Progressive Disclosure Architecture (PDA)

### Evidence-First Exploration
Avant toute modif : lire fichiers ouverts + README + CLAUDE.md, `package.json`, `tsconfig.json`, `.env.example`, `git log --oneline -20`, commentaires `TODO/FIXME/HACK`. Ne jamais modifier du code non lu.

### Complexité cyclomatique
Seuil **M ≤ 10** (ISO 25010). ESLint rule active. Fonctions > 10 branches → extraire en sous-fonctions.

### Couverture tests (cibles ISO 25010)

| Métrique   | Actuel | Cible |
|---|---|---|
| Statements | ≥ 78% | ≥ 80% |
| Branches   | ≥ 65% | ≥ 80% |
| Functions  | ≥ 83% | ≥ 85% |
| Lines      | ≥ 80% | ≥ 85% |

Thresholds dans `vitest.config.ts`. Build CI échoue sous seuil.

### Software Immunology
À chaque session : `npm run type-check`, `npm run lint`, `npm run test:run`. Gitleaks dans CI.

### Antifragilité — protocole obstacles
1. Résoudre à la source → 2. Modifier alentour → 3. Contourner → 4. Recréer → 5. Imiter. Documenter ce qui a été contourné.

### Validation chain pré-commit
```bash
npm run test:run && npm run type-check && npm run lint && git commit -m "type(scope): description"
```

### Auto-commit + auto-push (règle permanente, depuis 2026-08-27)
Après CHAQUE fix/feature validé par `type-check` + `lint` + `vitest run` (0 erreur) :
1. Stage uniquement les fichiers de ce fix précis (jamais `git add -A`/`.` — voir règle globale sur les fichiers sensibles/artefacts de build).
2. Commit avec message conventional clair.
3. Push direct vers la branche active (`main` en pratique) pour déclencher le déploiement Vercel.
4. Ne PAS demander confirmation avant de commit/push — confirmer seulement APRÈS, avec le hash/plage de commit poussée.

Cette autorisation couvre le commit + push normal. Reste soumis à confirmation : tout `--force`, `reset --hard`, réécriture d'historique, ou action touchant autre chose que le working tree local (ex. suppression de branche distante, modif de secrets Vercel/Supabase).

### Souveraineté des données
- Gemini : Edge Functions uniquement, jamais côté client
- Aucune donnée user envoyée à APIs tierces sans consentement
- Edge Functions : `corsHeaders` + handler `OPTIONS` + try/catch obligatoires
