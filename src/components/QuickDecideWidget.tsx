import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useHaptics } from '@/hooks/useHaptics';
import { markRide } from '@/lib/platformIdle';
import { decideRideOffer, type Decision } from '@/lib/rideDecision';
import { recordRide } from '@/lib/shiftTracker';
import { getRecognition, isVoiceSupported, parseVoiceTranscript, speak } from '@/lib/voiceDecision';
import { Check, Eraser, Mic, ThumbsDown, ThumbsUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * Driver-side "quick decide" tool — tap 3 numbers, get a verdict in <2 sec.
 *
 * Design constraints:
 * - Touch targets ≥48 px so it's usable at a red light without precision
 * - No screenshot, no Gemini call, no network — pure local computation
 * - Verdict re-computes on every keystroke so the driver sees it morphing
 *   live as they type. No "submit" friction.
 * - Pulls the same decideRideOffer() logic the screenshot agent uses, so
 *   the two paths give the same verdict for the same input.
 */
const FARE_CHIPS = [6, 10, 15, 20, 30, 45];
const APPROACH_KM_CHIPS = [1, 2, 3, 5, 8];
const RIDE_KM_CHIPS = [2, 5, 10, 15, 25];
const RIDE_MIN_CHIPS = [5, 10, 15, 25, 40];

/** Tap-to-set preset row — one tap fills the field, still editable via the input below it. */
function ChipRow({
  values,
  unit,
  current,
  onPick,
}: {
  values: readonly number[];
  unit: string;
  current: string;
  onPick: (value: number) => void;
}) {
  const currentNum = parseFloat(current);
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className={`min-h-[36px] px-2 rounded-md text-xs font-mono border transition-colors ${
            currentNum === v
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {v}
          {unit}
        </button>
      ))}
    </div>
  );
}

function QuickDecideHeaderActions({
  voiceAvail,
  listening,
  onVoice,
  showReset,
  onReset,
}: {
  voiceAvail: boolean;
  listening: boolean;
  onVoice: () => void;
  showReset: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {voiceAvail && (
        <Button
          size="sm"
          variant={listening ? 'default' : 'outline'}
          className={`h-7 gap-1 text-xs ${listening ? 'animate-pulse' : ''}`}
          onClick={onVoice}
        >
          <Mic className="w-3 h-3" />
          {listening ? 'Écoute…' : 'Vocal'}
        </Button>
      )}
      {showReset && (
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onReset}>
          <Eraser className="w-3 h-3" /> Reset
        </Button>
      )}
    </div>
  );
}

function PickupFields({
  pickupKm,
  setPickupKm,
  pickupMin,
  setPickupMin,
}: {
  pickupKm: string;
  setPickupKm: (v: string) => void;
  pickupMin: string;
  setPickupMin: (v: string) => void;
}) {
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer text-[10px]">+ Pickup (optionnel)</summary>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Pickup km</label>
          <ChipRow values={APPROACH_KM_CHIPS} unit="" current={pickupKm} onPick={(v) => setPickupKm(String(v))} />
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={pickupKm}
            onChange={(e) => setPickupKm(e.target.value)}
            placeholder="0.5"
            className="h-10 text-base font-mono text-center"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Pickup min</label>
          <Input
            type="number"
            inputMode="numeric"
            value={pickupMin}
            onChange={(e) => setPickupMin(e.target.value)}
            placeholder="2"
            className="h-10 text-base font-mono text-center"
          />
        </div>
      </div>
    </details>
  );
}

export function QuickDecideWidget() {
  const [fare, setFare] = useState('');
  const [rideKm, setRideKm] = useState('');
  const [rideMin, setRideMin] = useState('');
  const [pickupKm, setPickupKm] = useState('');
  const [pickupMin, setPickupMin] = useState('');
  const { vibrate } = useHaptics();
  const [listening, setListening] = useState(false);
  const voiceAvail = isVoiceSupported();

  const decision: Decision | null = useMemo(() => {
    const fareNum = parseFloat(fare);
    const rideKmNum = parseFloat(rideKm);
    const rideMinNum = parseFloat(rideMin);
    if (!Number.isFinite(fareNum) || fareNum <= 0) return null;
    if (!Number.isFinite(rideKmNum) && !Number.isFinite(rideMinNum)) return null;
    return decideRideOffer({
      earnings: fareNum,
      pickupTimeMin: parseFloat(pickupMin) || 0,
      pickupDistKm: parseFloat(pickupKm) || 0,
      rideTimeMin: Number.isFinite(rideMinNum) ? rideMinNum : null,
      rideDistKm: Number.isFinite(rideKmNum) ? rideKmNum : null,
    });
  }, [fare, rideKm, rideMin, pickupKm, pickupMin]);

  // Buzz once when the verdict flips between take / skip / meh
  const [lastVerdict, setLastVerdict] = useState<string | null>(null);
  useEffect(() => {
    if (!decision) return;
    if (decision.verdict !== lastVerdict) {
      setLastVerdict(decision.verdict);
      vibrate(decision.verdict === 'take' ? 'completed' : decision.verdict === 'skip' ? 'error' : 'newOrder');
    }
  }, [decision, lastVerdict, vibrate]);

  function clear() {
    setFare('');
    setRideKm('');
    setRideMin('');
    setPickupKm('');
    setPickupMin('');
    setLastVerdict(null);
  }

  function startVoice() {
    const rec = getRecognition();
    if (!rec) {
      toast.error('Reconnaissance vocale non supportée');
      return;
    }
    setListening(true);
    rec.onresult = (event) => {
      const transcript = event.results[0]![0]!.transcript;
      const parsed = parseVoiceTranscript(transcript);
      if (parsed.fare != null) setFare(parsed.fare.toString());
      if (parsed.rideKm != null) setRideKm(parsed.rideKm.toString());
      if (parsed.rideMin != null) setRideMin(parsed.rideMin.toString());
      if (parsed.pickupKm != null) setPickupKm(parsed.pickupKm.toString());
      if (parsed.pickupMin != null) setPickupMin(parsed.pickupMin.toString());
      // Speak the verdict back as soon as we have enough to compute it
      setTimeout(() => {
        const d = decideRideOffer({
          earnings: parsed.fare,
          pickupTimeMin: parsed.pickupMin ?? 0,
          pickupDistKm: parsed.pickupKm ?? 0,
          rideTimeMin: parsed.rideMin,
          rideDistKm: parsed.rideKm,
        });
        if (d.verdict === 'take') speak('Accepte !');
        else if (d.verdict === 'skip') speak('Refuse.');
        else speak('Au feeling.');
      }, 100);
    };
    rec.onerror = () => {
      toast.error('Erreur micro');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
  }

  function logRideToShift(platform: 'lyft' | 'uber' | 'hypra' | 'imoove' | 'doordash' = 'lyft') {
    const fareNum = parseFloat(fare);
    if (!Number.isFinite(fareNum) || fareNum <= 0) return;
    recordRide({
      fare: fareNum,
      rideKm: parseFloat(rideKm) || null,
      rideMin: parseFloat(rideMin) || null,
      platform,
    });
    markRide(platform);
    window.dispatchEvent(new CustomEvent('delivroom:shift-updated'));
    toast.success(`Course $${fareNum.toFixed(2)} ajoutée au shift`);
    clear();
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Décider en 3 sec
          </span>
          <QuickDecideHeaderActions
            voiceAvail={voiceAvail}
            listening={listening}
            onVoice={startVoice}
            showReset={Boolean(fare || rideKm || rideMin)}
            onReset={clear}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tarif $</label>
            <ChipRow values={FARE_CHIPS} unit="$" current={fare} onPick={(v) => setFare(String(v))} />
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              placeholder="7.00"
              className="h-14 text-2xl font-mono text-center"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Course km</label>
            <ChipRow values={RIDE_KM_CHIPS} unit="" current={rideKm} onPick={(v) => setRideKm(String(v))} />
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={rideKm}
              onChange={(e) => setRideKm(e.target.value)}
              placeholder="4.2"
              className="h-14 text-2xl font-mono text-center"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Course min</label>
            <ChipRow values={RIDE_MIN_CHIPS} unit="" current={rideMin} onPick={(v) => setRideMin(String(v))} />
            <Input
              type="number"
              inputMode="numeric"
              value={rideMin}
              onChange={(e) => setRideMin(e.target.value)}
              placeholder="8"
              className="h-14 text-2xl font-mono text-center"
            />
          </div>
        </div>

        <PickupFields
          pickupKm={pickupKm}
          setPickupKm={setPickupKm}
          pickupMin={pickupMin}
          setPickupMin={setPickupMin}
        />

        {decision && <VerdictPanel decision={decision} />}

        {decision && decision.verdict !== 'meh' && (
          <Button
            onClick={() => logRideToShift('lyft')}
            variant="outline"
            className="w-full gap-2 border-green-500/40 text-green-300 hover:bg-green-500/10"
          >
            <Check className="w-4 h-4" />
            J'ai pris cette course — log au shift
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const VERDICT_CONFIG: Record<Decision['verdict'], { cls: string; label: string; Icon: typeof ThumbsUp }> = {
  take: {
    cls: 'bg-green-500 border-green-300 text-white shadow-[0_0_20px_rgba(34,197,94,0.6)]',
    label: 'ACCEPTE',
    Icon: ThumbsUp,
  },
  skip: {
    cls: 'bg-red-500 border-red-300 text-white shadow-[0_0_20px_rgba(239,68,68,0.6)]',
    label: 'REFUSE',
    Icon: ThumbsDown,
  },
  meh: {
    cls: 'bg-amber-500 border-amber-300 text-black shadow-[0_0_20px_rgba(245,158,11,0.6)]',
    label: 'AU FEELING',
    Icon: Zap,
  },
};

function VerdictMetrics({ metrics }: { metrics: Decision['metrics'] }) {
  const items = [
    metrics.dollarsPerKm != null && { key: '$/km', value: `$${metrics.dollarsPerKm.toFixed(2)}` },
    metrics.effectiveHourlyRate != null && {
      key: '$/h tout',
      value: `$${metrics.effectiveHourlyRate.toFixed(0)}`,
    },
    metrics.paidHourlyRate != null && { key: '$/h payé', value: `$${metrics.paidHourlyRate.toFixed(0)}` },
  ].filter((item): item is { key: string; value: string } => Boolean(item));

  return (
    <div className="grid grid-cols-3 gap-1 text-center">
      {items.map((item) => (
        <div key={item.key}>
          <p className="text-[9px] opacity-60 uppercase">{item.key}</p>
          <p className="text-lg font-mono font-bold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function VerdictPanel({ decision }: { decision: Decision }) {
  const { cls, label, Icon } = VERDICT_CONFIG[decision.verdict];
  return (
    <div className={`rounded-xl border-2 p-3 space-y-2 ${cls}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-8 h-8" />
          <span className="text-4xl font-display font-black tracking-tight">{label}</span>
        </div>
        <Badge variant="outline" className="text-[10px] border-current">
          {decision.confidence}%
        </Badge>
      </div>
      <VerdictMetrics metrics={decision.metrics} />
      {decision.reasoning.length > 0 && (
        <ul className="text-[10px] opacity-80 space-y-0.5">
          {decision.reasoning.slice(0, 3).map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
