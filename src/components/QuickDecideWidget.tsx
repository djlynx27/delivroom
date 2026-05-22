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
      vibrate(decision.verdict === 'take' ? 'success' : decision.verdict === 'skip' ? 'error' : 'newOrder');
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
      const transcript = event.results[0][0].transcript;
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
          <div className="flex items-center gap-1">
            {voiceAvail && (
              <Button
                size="sm"
                variant={listening ? 'default' : 'outline'}
                className={`h-7 gap-1 text-xs ${listening ? 'animate-pulse' : ''}`}
                onClick={startVoice}
              >
                <Mic className="w-3 h-3" />
                {listening ? 'Écoute…' : 'Vocal'}
              </Button>
            )}
            {(fare || rideKm || rideMin) && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={clear}>
                <Eraser className="w-3 h-3" /> Reset
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tarif $</label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              placeholder="7.00"
              className="h-14 text-2xl font-mono text-center"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Course km</label>
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

        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer text-[10px]">
            + Pickup (optionnel)
          </summary>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Pickup km</label>
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

function VerdictPanel({ decision }: { decision: Decision }) {
  const cls =
    decision.verdict === 'take'
      ? 'bg-green-500/20 border-green-500/50 text-green-300'
      : decision.verdict === 'skip'
        ? 'bg-red-500/20 border-red-500/50 text-red-300'
        : 'bg-amber-500/15 border-amber-500/40 text-amber-300';
  const label =
    decision.verdict === 'take' ? 'ACCEPTE' : decision.verdict === 'skip' ? 'REFUSE' : 'AU FEELING';
  return (
    <div className={`rounded-xl border-2 p-3 space-y-2 ${cls}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {decision.verdict === 'take' && <ThumbsUp className="w-6 h-6" />}
          {decision.verdict === 'skip' && <ThumbsDown className="w-6 h-6" />}
          {decision.verdict === 'meh' && <Zap className="w-6 h-6" />}
          <span className="text-2xl font-display font-bold">{label}</span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {decision.confidence}%
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        {decision.metrics.dollarsPerKm != null && (
          <div>
            <p className="text-[9px] opacity-60 uppercase">$/km</p>
            <p className="text-lg font-mono font-bold">${decision.metrics.dollarsPerKm.toFixed(2)}</p>
          </div>
        )}
        {decision.metrics.effectiveHourlyRate != null && (
          <div>
            <p className="text-[9px] opacity-60 uppercase">$/h tout</p>
            <p className="text-lg font-mono font-bold">${decision.metrics.effectiveHourlyRate.toFixed(0)}</p>
          </div>
        )}
        {decision.metrics.paidHourlyRate != null && (
          <div>
            <p className="text-[9px] opacity-60 uppercase">$/h payé</p>
            <p className="text-lg font-mono font-bold">${decision.metrics.paidHourlyRate.toFixed(0)}</p>
          </div>
        )}
      </div>
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
