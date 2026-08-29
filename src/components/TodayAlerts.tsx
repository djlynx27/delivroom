import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/I18nContext';
import type { StmTransitStatus } from '@/hooks/useStmTransit';
import type { TimeBoost } from '@/lib/timeBoosts';
import type { YulStatus } from '@/lib/yulStatus';
import { Bell, Download, PartyPopper, WifiOff } from 'lucide-react';

interface EndingSoonEvent {
  id: string;
  name: string;
  end_at: string;
}

interface TodayAlertsProps {
  waitTimer: { zoneId: string; zoneName: string; startedAt: number } | null;
  waitDisplay: string;
  timerExpired: boolean;
  cancelTimer: () => void;
  dismissExpired: () => void;
  isOnline: boolean;
  canInstall: boolean;
  install: () => void;
  dismissInstall: () => void;
  notifEnabled: boolean;
  requestPermission: () => void;
  conservativePresence: boolean;
  holiday?: { isHoliday: boolean; name: string | null };
  cityId: string;
  habsGame?: { isHomeGame: boolean };
  yulStatus?: YulStatus | null;
  stmStatus?: StmTransitStatus | null;
  timeBoosts: TimeBoost[];
  endingSoon: EndingSoonEvent[];
  now: Date;
}

type TodayAlertsI18n = {
  t: (key: string) => string;
};

function AlertBox({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 ${className}`}
    >
      {children}
    </div>
  );
}

function DismissButton({
  onClick,
  ariaLabel,
}: {
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground text-xl leading-none px-1"
      aria-label={ariaLabel}
    >
      ×
    </button>
  );
}

function WaitTimerAlert({
  waitDisplay,
  zoneName,
  onCancel,
}: {
  waitDisplay: string;
  zoneName: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-primary/15 border border-primary/40 rounded-lg px-3 py-2">
      <div>
        <span className="text-[15px] font-display font-bold text-primary tabular-nums">
          ⏱ {waitDisplay}
        </span>
        <span className="text-[12px] text-muted-foreground font-body block">
          En attente · {zoneName}
        </span>
      </div>
      <DismissButton onClick={onCancel} ariaLabel="Annuler le timer" />
    </div>
  );
}

function ExpiredTimerAlert({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2">
      <span className="text-[14px] font-display font-bold text-destructive">
        ⏱ Temps de bouger ! Prochaine zone recommandée ↓
      </span>
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

function InstallPrompt({
  message,
  onInstall,
  onDismiss,
}: {
  message: string;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-primary/10 border border-primary/40 rounded-lg px-3 py-2">
      <Download className="w-4 h-4 text-primary flex-shrink-0" />
      <span className="flex-1 min-w-0 text-[13px] font-body text-primary font-medium">
        {message}
      </span>
      <button
        onClick={onInstall}
        className="bg-primary text-primary-foreground rounded-lg h-8 px-3 text-[12px] font-display font-semibold shrink-0 hover:bg-primary/90 transition-colors"
      >
        Installer
      </button>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0 text-lg leading-none"
        aria-label="Fermer"
      >
        ×
      </button>
    </div>
  );
}

function StmStatusAlert({ alertCount }: { alertCount: number }) {
  return (
    <AlertBox className="bg-orange-500/15 border border-orange-500/40">
      <span className="text-lg flex-shrink-0">🚇</span>
      <span className="text-[13px] font-body font-medium text-orange-400">
        Perturbation STM active — demande rideshare en hausse ({alertCount}{' '}
        alerte
        {alertCount > 1 ? 's' : ''})
      </span>
    </AlertBox>
  );
}

function EndingSoonAlerts({
  events,
  now,
}: {
  events: EndingSoonEvent[];
  now: Date;
}) {
  return (
    <>
      {events.map((event) => {
        const minutesLeft = Math.round(
          (new Date(event.end_at).getTime() - now.getTime()) / 60_000
        );

        return (
          <div
            key={event.id}
            className="flex items-center gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-2"
          >
            <span className="text-[14px] font-body font-bold text-destructive">
              🔴 {event.name} se termine dans {minutesLeft} min – Demande
              maximale prévue !
            </span>
          </div>
        );
      })}
    </>
  );
}

function SystemAlerts({
  waitTimer,
  waitDisplay,
  timerExpired,
  cancelTimer,
  dismissExpired,
  isOnline,
  canInstall,
  install,
  dismissInstall,
  t,
}: Pick<
  TodayAlertsProps,
  | 'waitTimer'
  | 'waitDisplay'
  | 'timerExpired'
  | 'cancelTimer'
  | 'dismissExpired'
  | 'isOnline'
  | 'canInstall'
  | 'install'
  | 'dismissInstall'
> &
  TodayAlertsI18n) {
  return (
    <>
      {waitTimer && (
        <WaitTimerAlert
          waitDisplay={waitDisplay}
          zoneName={waitTimer.zoneName}
          onCancel={cancelTimer}
        />
      )}
      {timerExpired && <ExpiredTimerAlert onDismiss={dismissExpired} />}
      {!isOnline && (
        <AlertBox className="bg-destructive/20 border border-destructive/40">
          <WifiOff className="w-5 h-5 text-destructive flex-shrink-0" />
          <span className="text-[14px] font-body font-medium text-destructive">
            {t('offline')}
          </span>
        </AlertBox>
      )}
      {canInstall && (
        <InstallPrompt
          message={t('installApp')}
          onInstall={install}
          onDismiss={dismissInstall}
        />
      )}
    </>
  );
}

function NotificationAlerts({
  notifEnabled,
  requestPermission,
  t,
}: Pick<TodayAlertsProps, 'notifEnabled' | 'requestPermission'> &
  TodayAlertsI18n) {
  return notifEnabled ? (
    <AlertBox className="bg-primary/10 border border-primary/30">
      <Bell className="w-4 h-4 text-primary flex-shrink-0" />
      <span className="text-[13px] font-body text-primary">
        {t('notificationsEnabled')}
      </span>
    </AlertBox>
  ) : (
    <Button
      onClick={requestPermission}
      variant="outline"
      className="w-full gap-2 border-accent/40 text-accent-foreground hover:bg-accent/10 h-12"
    >
      <Bell className="w-5 h-5" /> {t('enableNotifications')}
    </Button>
  );
}

function ConservativePresenceAlert() {
  return (
    <AlertBox className="bg-blue-500/10 border border-blue-500/30">
      <span className="text-lg flex-shrink-0">🎯</span>
      <span className="text-[13px] font-body text-blue-500">
        Présence prudente Lyft active: privilégie les filtres destination aux
        déplacements agressifs.
      </span>
    </AlertBox>
  );
}

function HolidayAlert({ name }: { name: string }) {
  return (
    <AlertBox className="bg-primary/10 border border-primary/30">
      <PartyPopper className="w-5 h-5 text-primary flex-shrink-0" />
      <span className="text-[14px] font-body font-medium text-primary">
        {name}
      </span>
    </AlertBox>
  );
}

function CanadiensGameAlert({ message }: { message: string }) {
  return (
    <AlertBox className="bg-accent/30 border border-accent">
      <span className="text-lg flex-shrink-0">🏒</span>
      <span className="text-[14px] font-body font-medium">{message}</span>
    </AlertBox>
  );
}

function YulWaveAlert({ message }: { message: string }) {
  return (
    <AlertBox className="bg-blue-500/15 border border-blue-500/40">
      <span className="text-lg flex-shrink-0">✈️</span>
      <span className="text-[13px] font-body font-medium text-blue-400">
        {message}
      </span>
    </AlertBox>
  );
}

function TimeBoostAlerts({
  timeBoosts,
  t,
}: Pick<TodayAlertsProps, 'timeBoosts'> & TodayAlertsI18n) {
  return (
    <>
      {timeBoosts.map((boost, index) => (
        <div
          key={index}
          className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2"
        >
          <span className="text-lg flex-shrink-0">{boost.icon}</span>
          <span className="text-[14px] font-body font-medium">
            {t(boost.bannerKey)}
          </span>
        </div>
      ))}
    </>
  );
}

function ContextualAlerts({
  conservativePresence,
  holiday,
  cityId,
  habsGame,
  yulStatus,
  stmStatus,
  timeBoosts,
  endingSoon,
  now,
  t,
}: Pick<
  TodayAlertsProps,
  | 'conservativePresence'
  | 'holiday'
  | 'cityId'
  | 'habsGame'
  | 'yulStatus'
  | 'stmStatus'
  | 'timeBoosts'
  | 'endingSoon'
  | 'now'
> &
  TodayAlertsI18n) {
  const hasMontrealGame = cityId === 'mtl' && habsGame?.isHomeGame;
  const hasYulWave =
    cityId === 'mtl' && yulStatus?.isActivePeriod && yulStatus.currentWave;

  return (
    <>
      {conservativePresence && <ConservativePresenceAlert />}
      {holiday?.isHoliday && holiday.name && (
        <HolidayAlert name={holiday.name} />
      )}
      {hasMontrealGame && <CanadiensGameAlert message={t('canadiensGame')} />}
      {hasYulWave && (
        <YulWaveAlert message={yulStatus!.currentWave!.rideshareImpact} />
      )}
      {stmStatus?.hasDisruption && (
        <StmStatusAlert alertCount={stmStatus.alertCount} />
      )}
      <TimeBoostAlerts timeBoosts={timeBoosts} t={t} />
      <EndingSoonAlerts events={endingSoon} now={now} />
    </>
  );
}

export function TodayAlerts({
  waitTimer,
  waitDisplay,
  timerExpired,
  cancelTimer,
  dismissExpired,
  isOnline,
  canInstall,
  install,
  dismissInstall,
  notifEnabled,
  requestPermission,
  conservativePresence,
  holiday,
  cityId,
  habsGame,
  yulStatus,
  stmStatus,
  timeBoosts,
  endingSoon,
  now,
}: TodayAlertsProps) {
  const { t } = useI18n();

  return (
    <div className="px-3 space-y-1.5 mt-2">
      <SystemAlerts
        waitTimer={waitTimer}
        waitDisplay={waitDisplay}
        timerExpired={timerExpired}
        cancelTimer={cancelTimer}
        dismissExpired={dismissExpired}
        isOnline={isOnline}
        canInstall={canInstall}
        install={install}
        dismissInstall={dismissInstall}
        t={t}
      />
      <NotificationAlerts
        notifEnabled={notifEnabled}
        requestPermission={requestPermission}
        t={t}
      />
      <ContextualAlerts
        conservativePresence={conservativePresence}
        holiday={holiday}
        cityId={cityId}
        habsGame={habsGame}
        yulStatus={yulStatus}
        stmStatus={stmStatus}
        timeBoosts={timeBoosts}
        endingSoon={endingSoon}
        now={now}
        t={t}
      />
    </div>
  );
}
