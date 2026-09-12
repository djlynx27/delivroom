# Bouton flottant "Lyft Overlay" → ouvrir Delivroom — recette MacroDroid

Quatrième flux de la série `*-macrodroid.md` (voir `navigate-deeplink-macrodroid.md`,
`ingest-lyft-screenshots-macrodroid.md`, `address-clipboard-macrodroid.md`) :
un bouton flottant (overlay) affiché par-dessus Lyft Driver qui, au tap,
ouvre Delivroom sur `/drive`.

> Pas de fichier de config côté repo — comme les trois autres recettes de
> cette série, MacroDroid ne lit aucun fichier du projet. Cette page décrit
> ce qu'il faut reproduire dans son UI Android, pas un artefact versionné.

## 0. Pourquoi le bouton ne réagissait plus

Deux pannes indépendantes, à vérifier dans cet ordre :

| # | Symptôme | Cause | Vérif |
|---|---|---|---|
| A | Le bouton overlay n'apparaît plus du tout (`Lyft Overlay Show` ne s'exécute pas) | One UI révoque silencieusement le service d'accessibilité MacroDroid après un certain temps ou une mise à jour — comportement Android normal, pas un bug MacroDroid | `Paramètres > Accessibilité > Apps installées > MacroDroid` — si le(s) toggle(s) sont OFF, c'est ça |
| B | Le bouton apparaît (`enabled: true`) mais le tap ne fait rien | L'action `Launch App` référence un package qui n'existe pas sur l'appareil | Voir §1 |

## 1. Le vrai piège du package : ne PAS utiliser `Launch App`

Aucun des deux `packageId` déclarés dans `CLAUDE.md` (`com.delivroom.app`
Capacitor, `app.delivroom.driver` TWA) n'est installé sur le S23 Ultra —
Delivroom y tourne comme **WebAPK Chrome** avec un package généré
dynamiquement (`org.chromium.webapk.a723e1524e8ac6908_v2`, host
`com.android.chrome` — voir la section "Topologie réelle" du `CLAUDE.md`).
Une action MacroDroid `Launch App` qui pointe sur `com.delivroom.app` ou
`app.delivroom.driver` est donc un no-op silencieux : le package cible
n'existe pas, MacroDroid ne peut rien lancer et ne remonte aucune erreur
visible.

**Fix :** remplacer `Launch App` par une action `Send Intent` :

- Target : `Activity`
- Action : `android.intent.action.VIEW`
- Data : `https://delivroom.vercel.app/drive`
- **Ne pas** renseigner de `package` explicite sur l'intent — laisser Android
  résoudre lui-même quelle app gère cette URL.

## 2. ⚠️ Point à vérifier sur l'appareil avant de considérer le fix réglé

`assetlinks.json` (`public/.well-known/assetlinks.json`) ne déclare comme
handler vérifié que le package **`app.delivroom.driver`** (la TWA) :

```json
{
  "target": {
    "package_name": "app.delivroom.driver",
    "sha256_cert_fingerprints": ["11:3A:BA:D8:F1:EF:BE:87:2C:CF:30:E0:1D:F5:DE:D5:C4:E0:4A:17:7B:E6:AD:1D:9D:44:FA:4C:DE:7E:97:DA"]
  }
}
```

Ce package n'est **pas** celui installé sur le S23 Ultra (§1). Le fait qu'un
`ACTION_VIEW` sans package explicite ouvre le WebAPK plutôt qu'un onglet
Chrome ne dépend donc pas d'`assetlinks.json` mais d'un réglage Android
propre à ce WebAPK :

```
Paramètres > Apps > [l'app WebAPK Delivroom, listée séparément de Chrome
malgré le host com.android.chrome] > Ouvrir par défaut > Liens pris en charge
```

Si ce réglage n'est pas sur "Ouvrir dans cette appli", l'intent ouvre un
onglet Chrome normal plutôt que le WebAPK installé — comportement
fonctionnellement correct (la page `/drive` charge quand même) mais pas
"l'app" au sens où MacroDroid/l'utilisateur s'y attend. À vérifier une fois
sur l'appareil, pas quelque chose que ce repo peut garantir depuis
`assetlinks.json` puisque ce fichier ne couvre que la TWA non installée ici.

## 3. Étapier d'application (S23 Ultra)

1. **Accessibilité** — bascule physique (pas d'ADB, Android bloque
   `WRITE_SECURE_SETTINGS` sur ce toggle pour les apps tierces) :
   `Paramètres > Accessibilité > Apps installées > MacroDroid` → les deux
   toggles ON.
2. **Macro** — MacroDroid matche par `m_GUID`, donc éditer `Lyft Overlay
   Button` en place plutôt que la recréer : remplacer l'action `Launch App`
   par le `Send Intent` du §1, sauvegarder.
3. **Position/visibilité** — vérifier que la position de départ de l'overlay
   n'est pas sous la barre de statut ou la caméra frontale, et que les
   macros compagnes `Lyft Overlay Show` / `Lyft Overlay Hide` sont bien
   actives (vert) dans la liste MacroDroid.
4. **Réglage WebAPK** — voir §2, à faire une seule fois.

## 4. Vérifier

Tap sur le bouton overlay pendant que Lyft Driver est au premier plan →
Delivroom doit s'ouvrir sur `/drive` (auth anonyme, pas d'écran de login —
voir `AppContent` dans `src/App.tsx`). Si rien ne s'ouvre après le fix du
§1, le blocage est côté accessibilité (§0-A), pas côté intent.

Le flux "capture séquentielle 75,1038" (Lyft 3 Functions) est un sujet
différent — c'est un `Screen Content`/OCR sur les coordonnées d'un élément
Lyft Driver, pas un bouton overlay Delivroom. Si des données n'entrent pas
côté Supabase malgré une capture qui semble s'exécuter, ce n'est pas lié à
ce fix : voir les `function_logs` de l'Edge Function concernée
(`analyze-screenshot` / `ingest-lyft-screenshots`) pour un 429/502 Gemini
avant de rouvrir ce doc.
