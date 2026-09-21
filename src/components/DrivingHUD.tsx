import { useHaptics } from '@/hooks/useHaptics';
import {
  AddressSearchBox,
  type AddressSearchResult,
} from '@/components/drive/AddressSearchBox';
import { EventBoostBadge } from '@/components/EventBoostBadge';
import { ReturnCorridorBadge } from '@/components/drive/ReturnCorridorBadge';
import { SurgeIndicator } from '@/components/SurgeIndicator';
import type { ReturnCorridorStep } from '@/lib/scoringEngine';
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
  eventBadge?: { name: string; endAt: string } | null;
}

interface DrivingHUDProps {
  heroZone: DrivingHUDZone | null;
  heroSurge?: SurgeResult | null;
  nextZone?: DrivingHUDZone | null;
  earningsToday?: number;
  speedKmh?: number | null;
  /** Active return-corridor toward heroZone (anti-deadhead), if any. */
  returnCorridor?: { steps: ReturnCorridorStep[] } | null;
  /** Driver GPS position, forwarded to AddressSearchBox for proximity bias. */
  proximity?: { latitude: number; longitude: number };
  /** False while GPS/scores are unconfirmed-live and the offline grace
   * period hasn't elapsed — see useNavTrustState. Blocks NAVIGUER on the
   * hero zone; manual address search stays available regardless. */
  canTrustNav?: boolean;
  /** Status text to show above NAVIGUER while `canTrustNav` is false. */
  navTrustBadge?: string | null;
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

const CALCULATING_TIMEOUT_MS = 2_500;

// heroZone starts null on a genuinely first-ever launch with no cached
// zones yet (see useZones' localStorage fallback in useSupabase.ts) and a
// slow/failed network — every OTHER case (returning driver, cache hit)
// should populate heroZone near-instantly. Past this timeout there's no
// fake zone data to invent, so this just stops looking silently frozen.
function CalculatingPlaceholder() {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setElapsed(true), CALCULATING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="text-white/30 text-2xl text-center px-4">
      {elapsed ? 'GPS en attente de signal ou de réseau…' : 'Calcul…'}
    </div>
  );
}

function HeroZoneDisplay({
  heroZone,
  heroSurge,
  score,
  color,
  returnCorridor,
}: {
  heroZone: DrivingHUDZone | null;
  heroSurge?: SurgeResult | null;
  score: number;
  color: string;
  returnCorridor?: { steps: ReturnCorridorStep[] } | null;
}) {
  if (!heroZone) {
    return <CalculatingPlaceholder />;
  }

  return (
    <>
      <div
        className="text-4xl sm:text-5xl font-black text-center leading-tight font-display line-clamp-2 overflow-hidden"
        style={{ color }}
        aria-label={`Meilleure zone: ${heroZone.name}`}
      >
        {heroZone.name}
      </div>

      {/* key={score} remounts the node so the pop animation replays whenever
          the score itself changes, not on every unrelated re-render.
          Defensive rendering: score is always a clamped 0-100 integer by
          the time it reaches here (see useDemandScores.ts's toFiniteNumber
          and the final Math.round/clamp), but max-w-full + truncate +
          responsive sizing (text-7xl on narrow phones, text-9xl from sm up)
          are a last-resort guard so a malformed value can never blow out
          the card's width instead of just looking wrong. */}
      <div
        key={score}
        className="max-w-full truncate text-7xl sm:text-9xl font-black tabular-nums leading-none animate-spring-pop"
        style={{ color }}
        aria-label={`Score: ${Math.round(score)} sur 100`}
      >
        {Math.round(score)}
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

      {heroZone.eventBadge && (
        <EventBoostBadge
          name={heroZone.eventBadge.name}
          endAt={heroZone.eventBadge.endAt}
          className="mt-1"
        />
      )}

      {returnCorridor?.steps && returnCorridor.steps.length > 0 && (
        <ReturnCorridorBadge
          steps={returnCorridor.steps}
          hubName={heroZone.name}
          className="mt-1"
        />
      )}
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
  returnCorridor,
  proximity,
  canTrustNav = true,
  navTrustBadge = null,
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
    if (!heroZone || !canTrustNav) return;
    vibrate('navigation');
    onNavigate(heroZone);
  }

  function handleExitClick() {
    vibrate('accepted');
    onExit();
  }

  // Zero-friction from the HUD too: picking a searched address navigates
  // immediately (history-saving already happened inside AddressSearchBox)
  // and closes the HUD in the background, same as a manual exit, so the
  // driver lands back on the normal Drive screen once Maps opens/returns.
  function handleAddressSelect(result: AddressSearchResult) {
    onNavigate({ ...result, score: 0 });
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
      className="fixed inset-0 z-50 flex flex-col select-none touch-none overflow-visible"
      style={{
        background: '#08081a',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      role="region"
      aria-label="Mode conduite actif"
    >
      {/* Address search — sits above the clock/speed/metrics rows so it's
          reachable without leaving the HUD. Suggestions/history dropdown
          needs the HUD's overflow-visible + its own z-[70] (AddressSearchBox)
          to paint over the rows below instead of being clipped. */}
      <div className="px-4 pt-3">
        <AddressSearchBox onSelect={handleAddressSelect} proximity={proximity} />
      </div>

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

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 gap-2 overflow-hidden">
        <Car className="w-9 h-9 opacity-30 flex-shrink-0" style={{ color }} />
        <HeroZoneDisplay
          heroZone={heroZone}
          heroSurge={heroSurge}
          score={score}
          color={color}
          returnCorridor={returnCorridor}
        />
      </div>

      <NextZonePill nextZone={nextZone} onNavigate={onNavigate} />

      {navTrustBadge && (
        <p className="px-6 text-center text-white/40 text-sm animate-pulse">
          {navTrustBadge}
        </p>
      )}

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
          disabled={!heroZone || !canTrustNav}
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
