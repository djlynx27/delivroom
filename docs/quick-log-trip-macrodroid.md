# `quick-log-trip` — logger un gain sans ouvrir l'app (recette MacroDroid)

Edge Function zero-UI : poste un montant dès la fin d'une course (bouton
MacroDroid, ou toute macro déclenchée par l'écran "Trip completed" de
Lyft/Hypra/Imoove) directement dans `public.trips`, sans jamais ouvrir
Delivroom. Voir `supabase/functions/quick-log-trip/index.ts`.

> Pas de fichier de config côté repo pour la macro elle-même — même
> convention que les 3 autres `*-macrodroid.md`. Ce doc couvre le setup
> serveur (secrets, déploiement) ET la recette MacroDroid.

## 0. Pourquoi cette fonction existe — et pourquoi "Aujourd'hui" reste à 0$

Le pipeline de capture automatique (`ingest-lyft-screenshots`, "Lyft 3
Functions") n'écrit **jamais** dans `trips` — il alimente `platform_signals`
pour le scoring de zones (`useDemandScores.ts`), pas les gains affichés dans
l'onglet Aujourd'hui. Le seul écriture dans `trips` avec `source: 'real'`
vient de deux chemins : (1) saisie manuelle via `TripLogger`/`useAddTrip`
dans l'app, ou (2) cette fonction. Sans l'un des deux configuré, rouler toute
la journée avec la capture automatique active laisse le dashboard à 0$ —
comportement attendu du pipeline actuel, pas un bug de synchro/cache/fuseau
horaire (le bouton "Synchroniser" force déjà un vrai `refetch()` réseau, et
le filtre "aujourd'hui" est déjà DST-safe sur `America/Toronto`, voir
`src/lib/timezone.ts`).

## 1. ⚠️ Piège d'identité — auth anonyme Supabase et RLS

`trips_user_isolation` (RLS) exige `auth.uid() = user_id` pour lire ET
écrire (`supabase/migrations/20260826000004_fix_rls_performance_advisors.sql`).
L'app utilise `signInAnonymously()` (`useAnonAuth.ts`) — un utilisateur
anonyme Supabase dont l'identité vit dans `localStorage`. **Si le stockage de
l'origine se fait vider par Chrome** (pression de stockage, faible
engagement, l'app n'appelle `navigator.storage.persist()` que depuis le fix
du 2026-09-12 dans `src/main.tsx`), la prochaine ouverture crée un **nouvel**
utilisateur anonyme — et toutes les courses déjà loggées sous l'ancien id
deviennent invisibles pour toujours côté RLS (elles restent en DB, juste
plus jamais lisibles par la session courante).

**Conséquence pratique :** `QUICK_LOG_DRIVER_USER_ID` doit être l'id de
l'utilisateur anonyme **actuellement actif** sur le téléphone, pas un id
figé une fois pour toutes. Pour le retrouver (ou vérifier qu'il n'a pas
changé depuis) :

```sql
select user_id, count(*) as trips, max(started_at) as last_trip
from public.trips
where source = 'real'
group by user_id
order by last_trip desc;
```

L'id avec le `last_trip` le plus récent est l'identité active. Si un
`last_trip` ancien (plusieurs jours) coexiste avec un nouvel utilisateur
anonyme récent dans `auth.users` (`select id, created_at from auth.users
order by created_at desc limit 5`) sans aucune course dessus, c'est ce
piège — pas un bug de `quick-log-trip`.

## 2. Setup serveur (une fois)

```powershell
supabase secrets set QUICK_LOG_API_KEY=<token-aléatoire-long>
supabase secrets set QUICK_LOG_DRIVER_USER_ID=<uuid-de-la-section-1>
supabase functions deploy quick-log-trip --no-verify-jwt
```

`QUICK_LOG_API_KEY` : un secret partagé simple (pas un JWT Supabase) —
MacroDroid ne peut pas tenir une vraie session Auth. Génère-le une fois,
colle-le dans le header `Authorization: Bearer <clé>` côté macro (§3).

## 3. Macro MacroDroid

1. **Trigger** : selon la plateforme — écran "Trip completed"/"Ride
   summary" de Lyft/Hypra/Imoove (`Screen Content (On Screen)`), ou un bouton
   overlay dédié si tu préfères confirmer le montant à la main plutôt que
   parser l'écran.
2. **Action "Extraire du texte"** (si lecture automatique du montant) →
   variable locale String `montant_course`. Sinon, un `Show Toast`/dialogue
   MacroDroid pour saisir le montant à la main fonctionne aussi.
3. **Action "HTTP Request"** :
   - Méthode : `POST`
   - URL : `https://hibzhsjgipybfihhzpxr.supabase.co/functions/v1/quick-log-trip`
   - Headers : `Authorization: Bearer <QUICK_LOG_API_KEY>`, `Content-Type: application/json`
   - Body (JSON) :
     ```json
     { "amount": {lv=montant_course}, "platform": "lyft" }
     ```
     `platform` : `lyft` | `hypra` | `imoove` (autre valeur → stockée `null`,
     pas une erreur). `tips`/`notes` optionnels, mêmes clés.

## 4. Vérifier

Un `curl`/l'action HTTP MacroDroid doit renvoyer `{"ok":true,"trip_id":"..."}`.
Si `{"error":"Non autorisé"}` → mauvaise clé. Si `{"error":"Serveur mal
configuré (secrets manquants)"}` → un des deux secrets §2 n'est pas set. La
course doit apparaître dans l'onglet Aujourd'hui après un tap sur
"Synchroniser" (pas besoin de fermer/rouvrir l'app — `refetch()` suffit).

## 5. Fallback pendant que la macro n'est pas encore configurée

`TodayScreen` expose un bouton "Ajouter une course manuellement" (ouvre
`TripLogger`, jusque-là accessible seulement via `/admin/operations`) —
utilisable directement pendant un quart tant que §2-3 n'est pas en place, ou
en secours si la macro rate un trigger.
