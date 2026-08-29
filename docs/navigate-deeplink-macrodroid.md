# `/navigate` — capture d'adresse externe → deep link MacroDroid/Tasker

Page `/navigate` (voir `src/pages/NavigateScreen.tsx`, alias
`/app/launch-gps` — même page, même comportement, juste un second chemin
pour les outils externes qui s'attendent à ce nom-là) : géocode une adresse
texte capturée dans une app rideshare (Lyft, Uber, etc.), résout le mode de
navigation demandé, puis redirige immédiatement (`window.location.href`)
vers Google Maps. Zéro backend — tout tourne client-side (géocodage Mapbox,
zones Supabase déjà en cache React Query, GPS du téléphone).

## 1. URL

```
https://delivroom.vercel.app/navigate?address=<adresse>&type=pickup|dropoff&mode=direct|prospection
https://delivroom.vercel.app/app/launch-gps?address=<adresse>&mode=direct
```

- `address` (obligatoire, URL-encodé) : texte brut capturé dans l'app
  rideshare — "1000 Rue de la Gauchetière, Montréal" fonctionne aussi bien
  qu'un nom de lieu ("Centre Bell").
- `mode` (optionnel, `direct` ou `prospection`, défaut `prospection` —
  préserve le comportement d'avant l'ajout de ce paramètre) :
  - `direct` : lien Google Maps pur origine → destination, **aucun**
    waypoint de prospection injecté. C'est le mode à utiliser pour une
    adresse envoyée par une app rideshare — le trajet client ne doit jamais
    être altéré par un détour de prospection Delivroom.
  - `prospection` : conserve le comportement historique (corridor
    `selectProspectionWaypoints`, hub à forte demande inséré si pertinent).
- `type` (optionnel, `pickup` ou `dropoff`, défaut `dropoff`) : n'affecte
  jamais le routage (ni le mode, ni le corridor) — sert seulement au libellé
  affiché pendant le chargement.

Le domaine est le host TWA vérifié (`twa-manifest.json` / `assetlinks.json`)
→ un `ACTION_VIEW` MacroDroid sur cette URL ouvre l'app Delivroom installée
directement (pas un onglet navigateur), donc l'app est déjà "auto-open" sans
config supplémentaire côté MacroDroid.

**Dans l'app**, chaque tap sur une zone recommandée, une adresse cherchée
manuellement, ou l'auto-routing 15 min épingle `mode: 'prospection'` en dur
côté code (`DriveScreen.resolveOneTapUrl` → `handleNavigationLaunch(...,
'prospection')`) — ce paramètre `mode` de l'URL ne concerne que les appels
externes.

## 2. Recette MacroDroid

1. **Trigger** : Accessibility → "Texte affiché à l'écran" (ou
   "Notification reçue") filtré sur le package Lyft Driver, sur l'écran
   où l'adresse pickup/dropoff apparaît.
2. **Action "Extraire du texte"** (regex ou position d'élément Accessibility)
   → variable locale `%adresse%`. Capture le texte de l'adresse exact tel
   qu'affiché.
3. **Action "Ouvrir URL" / "Lancer une intention"** (`ACTION_VIEW`) :
   ```
   https://delivroom.vercel.app/navigate?address=%adresse%(url encode)&type=dropoff&mode=direct
   ```
   MacroDroid encode l'URL via la fonction intégrée `url encode()` sur la
   variable — ne pas construire l'encodage à la main. `mode=direct` est
   important ici : une adresse client Lyft ne doit jamais recevoir un
   waypoint de prospection.

Pas de POST/webhook nécessaire : un simple deep link `GET` suffit puisque
tout le calcul se fait dans la page elle-même, pas côté serveur.

## 3. Recette Tasker (équivalent)

1. **Profile** : Event → Notification (app Lyft Driver) ou Accessibility
   plugin (AutoNotification / AutoInput) sur l'écran adresse.
2. **Task** :
   - Variable `%adresse%` extraite via `Regex Matches` / AutoInput.
   - Action `Browse URL` avec :
     ```
     https://delivroom.vercel.app/navigate?address=%adresse%&type=dropoff
     ```
     (Tasker encode automatiquement `%adresse%` dans `Browse URL` — pas
     besoin d'un `URL Encode` manuel séparé, sauf caractères déjà présents
     dans la variable qui casseraient l'URL, auquel cas passer par
     `%adresse%` → action `Variable Set` avec `URL Encode` activé d'abord.)

## 4. Vérifier

Ouvrir l'URL manuellement dans un navigateur avec une adresse test — la page
affiche un spinner ("Calcul de la route…") puis redirige vers Google Maps
avec, si un hub à forte demande se trouve sur le corridor, un waypoint
intermédiaire déjà inséré (identique au comportement du bouton in-app).
Adresse introuvable ou paramètre manquant → message d'erreur affiché sur la
page au lieu d'une redirection silencieuse.
