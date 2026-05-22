import { HealthMetricsTracker } from '@/components/HealthMetricsTracker';
import { QuestTracker } from '@/components/QuestTracker';
import { AdminPageShell } from '@/components/admin/AdminPageShell';

/**
 * Driver-side operations cockpit. Aggregates the trackers that aren't tied
 * to a specific zone or shift but rather to the driver's standing on each
 * gig platform: active bonus quests + account health metrics.
 */
export default function AdminDriverOpsScreen() {
  return (
    <AdminPageShell
      title="Driver Ops"
      description="Trackers de bonus quests + santé du compte sur chaque plateforme. Tient ton acceptance rate au-dessus du seuil et vise les bonus active."
    >
      <QuestTracker />
      <HealthMetricsTracker />
    </AdminPageShell>
  );
}
