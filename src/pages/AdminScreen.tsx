import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/contexts/I18nContext';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import {
  Brain,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Flag,
  FlaskConical,
  HeartPulse,
  LineChart,
  MapPin,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminScreen() {
  usePullToRefresh(() => window.location.reload());
  const { t } = useI18n();

  const sections = [
    {
      title: 'Opérations terrain',
      description:
        'Logger les courses, suivre les shifts et distinguer ce qui est local de ce qui nourrit vraiment le backend.',
      to: '/admin/operations',
      icon: Flag,
    },
    {
      title: 'Rapports & revenus',
      description:
        'Consulter les dashboards, rapports quotidiens et comparaisons, avec séparation entre $/h en course et shifts trackés.',
      to: '/admin/reports',
      icon: LineChart,
    },
    {
      title: 'Apprentissage IA',
      description:
        'Synchroniser l’apprentissage, recalibrer les poids et relancer l’analyse IA des zones.',
      to: '/admin/learning',
      icon: Brain,
    },
    {
      title: 'Imports & documents',
      description:
        'Importer des CSV et analyser des documents sans mélanger les historiques propres avec des extractions OCR incertaines.',
      to: '/admin/imports',
      icon: FileSpreadsheet,
    },
    {
      title: 'Outils & labo',
      description:
        'Villes, simulation et connecteurs externes. À réserver aux tests, pas à l’analyse métier finale.',
      to: '/admin/tools',
      icon: FlaskConical,
    },
    {
      title: 'Zones découvertes',
      description:
        'Adresses pickup/dropoff vues dans tes screenshots qui ne sont pas dans le catalog. Promouvoir en zone pour enrichir le scoring.',
      to: '/admin/discoveries',
      icon: MapPin,
    },
    {
      title: 'Driver Ops — bonus + santé',
      description:
        'Suivre tes bonus quests actifs (Lyft Weekly, Uber Quest) et garder un œil sur acceptance / cancellation / rating pour rester prioritaire dans le matching.',
      to: '/admin/driver-ops',
      icon: HeartPulse,
    },
  ] as const;

  return (
    <div className="flex flex-col h-full pb-28 overflow-y-auto">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-xl font-display font-bold">{t('admin')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hub allégé pour piloter les outils d’administration sans surcharger
          une seule page.
        </p>
      </div>

      <div className="px-4 space-y-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" /> Lecture rapide
              avant d’agir
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1.5">
            <p>
              Les blocs les plus sensibles pour la qualité des données sont les
              imports CSV et l’analyse de documents.
            </p>
            <p>
              Les rapports de revenus lisent le backend réel, mais les $/h
              doivent encore être lus en distinguant le temps en course des
              shifts réellement terminés et synchronisés.
            </p>
            <p>
              Le bouton admin sert désormais de hub, pas d’entrepôt de toutes
              les options sur une seule page.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {sections.map(({ title, description, to, icon: Icon }) => (
            <Card key={to} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2 mt-0.5">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[17px] font-display font-bold">
                      {title}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {description}
                    </p>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="gap-2 shrink-0"
                  >
                    <Link to={to}>
                      Ouvrir
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" /> Routine recommandée
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1.5">
            <p>1. Enregistre ou importe des courses propres.</p>
            <p>2. Vérifie les rapports et un échantillon de zones/imports.</p>
            <p>3. Synchronise l’apprentissage.</p>
            <p>4. Recalibre l’IA.</p>
            <p>5. Lance ensuite l’analyse IA des scores.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
