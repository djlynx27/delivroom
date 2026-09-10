import { BulkScreenshotUploader } from '@/components/BulkScreenshotUploader';
import { CsvImporter } from '@/components/CsvImporter';
import { MaxymoCsvImporter } from '@/components/MaxymoCsvImporter';
import { ScreenshotAnalyzer } from '@/components/ScreenshotAnalyzer';
import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Battery, Brain, Camera, FileSpreadsheet, FolderUp } from 'lucide-react';

export default function AdminImportsScreen() {
  return (
    <AdminPageShell
      title="Import de données"
      description="Alimente le moteur d'apprentissage avec tes vraies données de courses pour des suggestions personnalisées."
    >
      {/* Explication du flux */}
      <Card className="bg-primary/10 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2 text-primary">
            <Brain className="w-4 h-4" /> Comment ça fonctionne
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-primary/80 space-y-1.5">
          <p>
            <span className="font-semibold">Tes données réelles</span> →{' '}
            <span className="font-semibold">Algorithme d'apprentissage</span> →{' '}
            <span className="font-semibold">Suggestions personnalisées</span>
          </p>
          <p>
            Plus tu importes, plus les scores de zones reflètent <em>ta</em> réalité
            (horaires, plateforme, type de courses) plutôt que des moyennes théoriques.
          </p>
          <div className="pt-1 space-y-0.5">
            <p>• <span className="font-semibold">Lyft CSV</span> : Settings → Earnings → Export dans l'app Lyft</p>
            <p>• <span className="font-semibold">Imoove / Hypra</span> : Screenshots de tes résumés de course</p>
          </div>
        </CardContent>
      </Card>

      {/* Guide config Samsung — le bouton overlay Maxymo gèle après 2-3
          captures si l'OS tue le service d'accessibilité MacroDroid/Maxymo
          en arrière-plan (One UI Battery/App Standby). Réglages une fois,
          pas de re-config à chaque redémarrage. */}
      <details className="rounded-lg border border-amber-500/30 bg-amber-500/10">
        <summary className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-amber-100 cursor-pointer">
          <Battery className="w-4 h-4 shrink-0" /> Le bouton Screenshot Maxymo gèle après 2 captures ? Config Samsung ici
        </summary>
        <div className="px-3 pb-3 text-[11px] text-amber-100/90 space-y-2">
          <p>
            Cause probable : One UI met en veille le service d'accessibilité de Maxymo/MacroDroid
            (App Standby) — sans lui, le bouton overlay ne peut plus déclencher de capture. Trois
            réglages à faire <span className="font-semibold">une seule fois</span> :
          </p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              <span className="font-semibold">Batterie non restreinte</span> — Paramètres →
              Applications → Maxymo (et MacroDroid) → Batterie → « Non restreint ». Aussi :
              Paramètres → Soins de la batterie → Batterie → Limites d'utilisation en arrière-plan
              → Applications non surveillées → ajouter Maxymo + MacroDroid.
            </li>
            <li>
              <span className="font-semibold">Apparaître au-dessus des autres applis</span> —
              Paramètres → Applications → Maxymo (et MacroDroid) → Autorisations avancées →
              « Apparaître au-dessus » → activer. Permanent, pas besoin de le refaire.
            </li>
            <li>
              <span className="font-semibold">Verrouiller dans les récentes</span> — ouvre la vue
              Récents, appui long sur la vignette Maxymo (et MacroDroid) → icône cadenas
              « Verrouiller cette appli » pour empêcher le swipe-to-close accidentel de les tuer.
            </li>
          </ol>
          <p>
            Si ça gèle encore après ces 3 réglages, c'est probablement une limite Android elle-même
            (l'API de capture d'écran se bloque après quelques appels rapprochés, indépendamment de
            la batterie) — dans ce cas, compte sur l'auto-scan Delivroom ci-dessous : il détecte
            tout nouveau screenshot dans Pictures/Screenshots, Pictures/Lyft <em>et</em>{' '}
            Pictures/Maxymo, peu importe comment il a été pris (overlay, Vol-Down+Power, geste
            paume).
          </p>
        </div>
      </details>

      {/* Section 1 — Import bulk Maxymo (plusieurs screenshots d'un coup) */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <FolderUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wide text-muted-foreground">
            Import bulk Maxymo
          </h2>
        </div>
        <BulkScreenshotUploader />
      </div>

      {/* Section 2 — Screenshot unique (Imoove/Hypra/Lyft direct) */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <Camera className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wide text-muted-foreground">
            Screenshot unique (Imoove · Hypra · Lyft)
          </h2>
        </div>
        <ScreenshotAnalyzer />
      </div>

      {/* Section 3 — CSV Lyft */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <FileSpreadsheet className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wide text-muted-foreground">
            Fichier CSV (Lyft Export)
          </h2>
        </div>
        <CsvImporter />
      </div>

      {/* Section 4 — CSV Maxymo (offres acceptées + refusées) */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <FileSpreadsheet className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold uppercase tracking-wide text-muted-foreground">
            Fichier CSV (Maxymo Export)
          </h2>
        </div>
        <MaxymoCsvImporter />
      </div>

      {/* Note de prudence */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p>
            L'attribution de zone est heuristique pour les screenshots sans localisation GPS précise.
            Vérifie un échantillon après chaque import avant de tirer des conclusions.
          </p>
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
