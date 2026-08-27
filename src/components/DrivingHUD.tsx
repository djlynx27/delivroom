import { useHaptics } from '@/hooks/useHaptics';
import { SurgeIndicator } from '@/components/SurgeIndicator';
import type { SurgeResult } from '@/lib/surgeEngine';
import { Car, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface DrivingHUDZone {
  id: string;
  name: string;
  score: number;
  latitude: number;
  longitude: number;
  distKm?: number;
}

interface DrivingHUDProps {
  heroZone: DrivingHUDZone | null;
  heroSurge?: SurgeResult | null;
  nextZone?: DrivingHUDZone | null;
  earningsToday?: number;
  speedKmh?: number | null;
  onNavigate: (zone: DrivingHUDZone) => void;
  onExit: () => void;
}

function getDemandColor(score: number): string {
  if (score >= 70) return '#00e676'; // green
  if (score >= 40) return '#ffd600'; // amber
  return '#f44336'; // red
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n);
}

function getExitAriaLabel(exitHint: boolean) {
  return exitHint ? 'Quitter le mode conduite' : 'Quitter le mode conduite';
}

function ExitButton({
  exitHint,
  onClick,
}: {
  exitHint: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center rounded-2xl bg-white/10 active:bg-white/20 transition-colors"
      aria-label={getExitAriaLabel(exitHint)}
      style={{ minWidth: 64, minHeight: 64 }}
    >
      <X className="w-6 h-6 text-white/70" />
      {exitHint ? (
        <span className="text-[10px] text-white/60 mt-0.5">quitter</span>
      ) : null}
    </button>
  );
}

function HeroZoneDisplay({
  heroZone,
  heroSurge,
  score,
  color,
}: {
  heroZone: DrivingHUDZone | null;
  heroSurge?: SurgeResult | null;
  score: number;
  color: string;
}) {
  if (!heroZone) {
    return <div className="text-white/30 text-3xl">Calcul…</div>;
  }

  return (
    <>
      <div
        className="text-5xl font-black text-center leading-tight font-display"
        style={{ color }}
        aria-label={`Meilleure zone: ${heroZone.name}`}
      >
        {heroZone.name}
      </div>

      {/* key={score} remounts the node so the pop animation replays whenever
          the score itself changes, not on every unrelated re-render. */}
      <div
        key={score}
        className="text-9xl font-black tabular-nums leading-none animate-spring-pop"
        style={{ color }}
        aria-label={`Score: ${score} sur 100`}
      >
        {score}
      </div>
      <div className="text-white/30 text-2xl font-semibold">/100</div>

      {heroSurge && heroSurge.surgeClass !== 'normal' && (
        <SurgeIndicator
          surgeClass={heroSurge.surgeClass}
          multiplier={heroSurge.surgeMultiplier}
          size="lg"
        />
      )}

      {heroZone.distKm !== undefined ? (
        <div className="text-white/50 text-2xl font-semibold mt-1">
          {heroZone.distKm.toFixed(1)} km
        </div>
      ) : null}
    </>
  );
}

function NextZonePill({
  nextZone,
  onNavigate,
}: {
  nextZone?: DrivingHUDZone | null;
  onNavigate: (zone: DrivingHUDZone) => void;
}) {
  if (!nextZone) return null;

  return (
    <button
      onClick={() => onNavigate(nextZone)}
      className="mx-6 mb-3 min-h-16 px-5 py-3 rounded-2xl bg-white/5 active:bg-white/10 active:scale-[0.98] transition-transform flex items-center justify-between gap-3"
      aria-label={`Naviguer vers la prochaine zone : ${nextZone.name}`}
    >
      <span className="text-white/40 text-lg">Prochaine</span>
      <span className="text-white text-xl font-semibold flex-1 text-center truncate">
        {nextZone.name}
      </span>
      <span
        className="text-xl font-black"
        style={{ color: getDemandColor(nextZone.score) }}
      >
        {nextZone.score}
      </span>
    </button>
  );
}

/**
 * NHTSA-compliant driving HUD overlay.
 *
 * Design constraints (NHTSA Phase 1 guidelines):
 * - ≤ 7 data elements visible simultaneously
 * - Minimum font size 24 px for critical information
 * - All tap targets ≥ 64 dp (minimum 56px on screen)
 * - A single gesture accesses every critical action
 * - Exit stays visible at all times so the driver can return to the main screen quickly
 * - No text input, no scrolling while in HUD view
 */
export function DrivingHUD({
  heroZone,
  heroSurge,
  nextZone,
  earningsToday = 0,
  speedKmh,
  onNavigate,
  onExit,
}: DrivingHUDProps) {
  const { vibrate } = useHaptics();
  const [time, setTime] = useState(new Date());
  const [exitHint] = useState(true);

  // Keep clock updated every 30 s
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function handleNavClick() {
    if (!heroZone) return;
    vibrate('navigation');
    onNavigate(heroZone);
  }

  function handleExitClick() {
    vibrate('accepted');
    onExit();
  }

  const score = heroZone?.score ?? 0;
  const color = getDemandColor(score);
  const timeStr = time.toLocaleTimeString('fr-CA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none touch-none overflow-hidden"
      style={{ background: '#08081a' }}
      role="region"
      aria-label="Mode conduite actif"
    >
      {/* ── Row 1: Clock · Speed · Exit ── */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <span
          className="text-white text-4xl font-black tabular-nums font-display"
          aria-label={`Heure: ${timeStr}`}
        >
          {timeStr}
        </span>

        {/* Speed — data element 2 (only when available) */}
        {speedKmh !== null && speedKmh !== undefined && (
          <span className="text-white/50 text-2xl font-semibold">
            {Math.round(speedKmh)} <span className="text-lg">km/h</span>
          </span>
        )}

        <ExitButton exitHint={exitHint} onClick={handleExitClick} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-2">
        <Car className="w-9 h-9 opacity-30" style={{ color }} />
        <HeroZoneDisplay
          heroZone={heroZone}
          heroSurge={heroSurge}
          score={score}
          color={color}
        />
      </div>

      <NextZonePill nextZone={nextZone} onNavigate={onNavigate} />

      {/* ── Row 4: Earnings + Navigate CTA ── */}
      <div className="px-6 pb-10 flex gap-4">
        {/* Earnings — data element 7 */}
        <div
          className="flex flex-col items-center justify-center py-4 px-4 rounded-2xl bg-white/5"
          style={{ minWidth: 100, minHeight: 72 }}
        >
          <span className="text-white/40 text-sm">Gains</span>
          <span className="text-white text-2xl font-black">
            {formatMoney(earningsToday)}
          </span>
        </div>

        {/* Navigate — PRIMARY action, maximum tap target */}
        <button
          onClick={handleNavClick}
          disabled={!heroZone}
          className="flex-1 rounded-2xl font-black text-2xl font-display active:scale-95 transition-transform disabled:opacity-30"
          style={{
            backgroundColor: color,
            color: '#08081a',
            minHeight: 72,
          }}
          aria-label={`Naviguer vers ${heroZone?.name ?? 'zone'}`}
        >
          NAVIGUER
        </button>
      </div>
    </div>
  );
}
