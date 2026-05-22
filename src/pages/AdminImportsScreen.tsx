import { BulkScreenshotUploader } from '@/components/BulkScreenshotUploader';
import { CsvImporter } from '@/components/CsvImporter';
import { ScreenshotAnalyzer } from '@/components/ScreenshotAnalyzer';
import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, Camera, FileSpreadsheet, FolderUp } from 'lucide-react';

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
