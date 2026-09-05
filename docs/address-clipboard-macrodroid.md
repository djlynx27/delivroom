# Adresse → presse-papier + navigation — recette MacroDroid

Complète `navigate-deeplink-macrodroid.md` (deep link `/navigate` côté app) et
`ingest-lyft-screenshots-macrodroid.md` (ingestion de captures côté Edge
Function) avec le troisième flux : copier l'adresse pickup/stop/dropoff
affichée par Lyft Driver dans le presse-papier Android ET lancer Google Maps
en une seule macro, sans passer par l'app Delivroom.

> Pas de fichier de config côté repo (`macroConfig.ts` n'existe pas et n'a pas
> lieu d'être créé) : MacroDroid ne lit aucun fichier du projet, il se
> configure entièrement dans son UI Android. Cette page est la recette à
> reproduire dans cette UI — même convention que les deux docs `*-macrodroid.md`
> ci-dessus.

## 1. Macro "Lyft Adresse → Presse-papier"

Variante clipboard-only de la macro `Lyft_GPS_Google_Maps.macro` déjà
documentée (`ingest-lyft-screenshots-macrodroid.md` §"Lyft GPS Google Maps") —
mêmes triggers/pièges, une action de plus.

1. **Trigger** : `Screen Content (On Screen)`, regex `Pick up|Drop off|Stop \d|Navigate`
   (case insensitive), limité à `com.lyft.android.driver`.
2. **Action 1** : `Read Screen Contents` → variable locale String
   `adresse_lyft` (⚠️ forcer explicitement le type **String** à la création —
   l'assistant MacroDroid crée un Dictionary par défaut, piège déjà rencontré
   et documenté pour la macro GPS existante).
3. **Action 2** : `Set Clipboard` → valeur `{lv=adresse_lyft}`.
4. **Action 3 (toast de confirmation)** : `Show Toast` → texte
   `Adresse copiée dans le presse-papier`.
5. **Action 4** : `Send Intent` — target `Activity`, action
   `android.intent.action.VIEW`, package `com.google.android.apps.maps`,
   data `google.navigation:q={lv=adresse_lyft}&mode=d`.
6. **Contraintes anti-boucle** (identiques à la macro GPS existante — voir
   "Fix boucle infinie" dans `ingest-lyft-screenshots-macrodroid.md`) :
   variable `adresse_lyft_last_sent`, contrainte `{lv=adresse_lyft} !=
   {lv=adresse_lyft_last_sent}` ET `{lv=adresse_lyft} != ""` sur l'action Send
   Intent, puis `Set Variable adresse_lyft_last_sent = {lv=adresse_lyft}`
   après.

Le dédup se réarme automatiquement à la prochaine adresse différente (pickup
suivant, stop suivant, ou dropoff) — pas de reset manuel nécessaire.

## 2. Multi-stop (ride avec "Add a stop")

`Screen Content` ne connaît que le texte affiché à l'instant — il ne peut pas
distinguer "en route vers le pickup" de "passager à bord, en route vers le
1er arrêt" autrement que par le texte lui-même (Lyft affiche "Pick up",
"Stop 1", "Stop 2", "Drop off" à des écrans distincts). Le regex du trigger
(`Pick up|Drop off|Stop \d|Navigate`) capture déjà les trois cas — chaque
transition d'écran refire le trigger avec la nouvelle adresse, donc la macro
copie/navigue automatiquement vers la PROCHAINE étape à chaque fois sans
logique de phase supplémentaire à construire côté MacroDroid.

Le pendant applicatif (screenshot analysé manuellement via Delivroom plutôt
que lu par Accessibility) vit côté app : `analyze-screenshot` retourne un
`trip_waypoints` ordonné quand Gemini détecte 3+ arrêts sur la capture, et
`ScreenshotAnalyzer` expose un bouton "Copier prochain arrêt / adresse
pickup / adresse dropoff" qui avance dans cette séquence à chaque tap — voir
`src/lib/tripSave.ts` (`resolveTripWaypoints`, `resolveNextNavigationWaypoint`)
et `src/components/ScreenshotAnalyzer.tsx`.

## 3. Vérifier

Ouvre Lyft Driver sur un trajet de test, avance jusqu'à l'écran pickup —
toast "Adresse copiée dans le presse-papier" doit apparaître et Google Maps
doit s'ouvrir en navigation vers cette adresse. Colle le presse-papier
(long-press dans une barre d'adresse quelconque) pour confirmer le contenu
exact.
