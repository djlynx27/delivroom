import { LabOnly } from '@/components/BuildTargetGates';
import { DailyReports } from '@/components/DailyReports';
import { EarningsReport } from '@/components/EarningsReport';
import { ExperimentalShiftComparison } from '@/components/ExperimentalShiftComparison';
import { RevenueDashboard } from '@/components/RevenueDashboard';
import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminReportsScreen() {
  return (
    <AdminPageShell
      title="Admin · Rapports"
      description="Lecture consolidée des revenus, des rapports quotidiens et des comparaisons. Les shifts réellement terminés et synchronisés servent maintenant aussi aux métriques de temps total tracké."
    >
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display">
            Attention sur les $/h
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1.5">
          <p>
            Les dashboards actuels calculent surtout le revenu par heure de
            course enregistrée, mais affichent aussi désormais un $/h de shift
            tracké quand des sessions ont été synchronisées.
          </p>
          <p>
            Si un document agrégé ou un import approximatif a créé des trips
            trop courts, les résultats peuvent paraître artificiellement élevés.
          </p>
        </CardContent>
      </Card>

      <RevenueDashboard />

      <div className="space-y-1">
        <h2 className="text-[18px] font-display font-bold px-1">
          Rapport de revenus
        </h2>
        <EarningsReport />
      </div>

      <DailyReports />
      <LabOnly>
        <ExperimentalShiftComparison />
      </LabOnly>
    </AdminPageShell>
  );
}
