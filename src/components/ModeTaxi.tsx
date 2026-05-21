import { Switch } from '@/components/ui/switch';
import { haversineKm, useUserLocation } from '@/hooks/useUserLocation';
import { summarizeTaxiEntries } from '@/lib/taxiAnalytics';
import { validateTaxiEntryForm } from '@/lib/taxiEntryValidation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDemandScores } from '@/hooks/useDemandScores';
import {
  Car,
  Clock,
  DollarSign,
  Download,
  FlaskConical,
  MapPin,
  Play,
  Square,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────
interface Earning {
  id: string;
  date: string;
  amount: number;
  km: number;
  duration_min: number;
  note: string;
  created_at: string;
}

interface EarningInsert {
  date: string;
  amount: number;
  km: number;
  duration_min: number;
  note?: string | null;
}

const EARNINGS_STORAGE_KEY = 'delivroom_taxi_earnings';

function readStoredEarnings(): Earning[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(EARNINGS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is Partial<Earning> =>
          typeof item === 'object' && item !== null
      )
      .map((item, index) => ({
        id:
          typeof item.id === 'string' && item.id.length > 0
            ? item.id
            : `earning-${index}-${Date.now()}`,
        date:
          typeof item.date === 'string'
            ? item.date
            : new Date().toISOString().split('T')[0],
        amount: Number(item.amount ?? 0),
        km: Number(item.km ?? 0),
        duration_min: Number(item.duration_min ?? 0),
        note: typeof item.note === 'string' ? item.note : '',
        created_at:
          typeof item.created_at === 'string' && item.created_at.length > 0
            ? item.created_at
            : new Date().toISOString(),
      }))
      .sort((left, right) => right.date.localeCompare(left.date));
  } catch {
    return [];
  }
}

function writeStoredEarnings(entries: Earning[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(EARNINGS_STORAGE_KEY, JSON.stringify(entries));
}

// ── Hooks ─────────────────────────────────────────────────────────────
function useEarnings(period: 'day' | 'week' | 'month') {
  const now = new Date();
  let from: string;
  if (period === 'day') {
    from = now.toISOString().split('T')[0];
  } else if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    from = d.toISOString().split('T')[0];
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    from = d.toISOString().split('T')[0];
  }

  return useQuery<Earning[]>({
    queryKey: ['earnings', period],
    queryFn: async () => {
      return readStoredEarnings().filter((entry) => entry.date >= from);
    },
  });
}

function useAddEarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: EarningInsert) => {
      const nextEntry: Earning = {
        id:
          typeof crypto !== 'undefined' &&
          typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `earning-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        date: entry.date,
        amount: entry.amount,
        km: entry.km,
        duration_min: entry.duration_min,
        note: entry.note ?? '',
        created_at: new Date().toISOString(),
      };

      writeStoredEarnings([nextEntry, ...readStoredEarnings()]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['earnings'] }),
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ── Flat Rates ────────────────────────────────────────────────────────
const FLAT_RATES = [
  { from: 'YUL Aéroport', to: 'Centre-ville', day: 49.45, night: 56.7 },
  { from: 'YUL Aéroport', to: 'Laval', day: 65.0, night: 75.0 },
  { from: 'YUL Aéroport', to: 'Rive-Sud', day: 72.0, night: 82.0 },
  { from: 'Laval', to: 'Centre-ville', day: 45.0, night: 52.0 },
  { from: 'Rive-Sud', to: 'Centre-ville', day: 40.0, night: 46.0 },
  { from: 'Gare Centrale', to: 'YUL Aéroport', day: 49.45, night: 56.7 },
];

// ── Component ─────────────────────────────────────────────────────────
export function ModeTaxi() {
  const { location: userLocation } = useUserLocation(10000);
  const { scores, zones } = useDemandScores('mtl');
  const addEarning = useAddEarning();

  // Earnings form
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    km: '',
    durationMin: '',
    note: '',
  });
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const { data: earnings = [] } = useEarnings(period);

  // Mileage tracker
  const [tripStart, setTripStart] = useState<{
    lat: number;
    lng: number;
    time: number;
  } | null>(null);
  const [tripActive, setTripActive] = useState(false);
  const [tripElapsed, setTripElapsed] = useState(0);

  // Dwell timer
  const [dwellSeconds, setDwellSeconds] = useState(0);

  // Trip elapsed timer
  useEffect(() => {
    if (!tripActive || !tripStart) return;
    const id = setInterval(
      () => setTripElapsed(Math.floor((Date.now() - tripStart.time) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [tripActive, tripStart]);

  // Dwell timer - check if near a major zone
  const nearbyZone = useMemo(() => {
    if (!userLocation || zones.length === 0) return null;
    const majorTypes = ['aéroport', 'transport', 'métro', 'tourisme'];
    for (const zone of zones) {
      if (!majorTypes.includes(zone.type)) continue;
      const dist = haversineKm(
        userLocation.latitude,
        userLocation.longitude,
        zone.latitude,
        zone.longitude
      );
      if (dist <= 0.5) {
        const score = scores.get(zone.id) ?? 0;
        return { zone, dist, score };
      }
    }
    return null;
  }, [userLocation, zones, scores]);

  useEffect(() => {
    if (!nearbyZone) {
      setDwellSeconds(0);
      return;
    }
    const id = setInterval(() => setDwellSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [nearbyZone]);

  const estimatedWait = nearbyZone
    ? nearbyZone.score > 70
      ? '~5 min'
      : nearbyZone.score >= 40
        ? '~15 min'
        : '~30 min'
    : null;

  // Totals
  const totals = useMemo(() => {
    return summarizeTaxiEntries(earnings);
  }, [earnings]);

  const handleAddEntry = async () => {
    const validation = validateTaxiEntryForm(form);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    const { amount, km, durationMin } = validation.values;

    try {
      await addEarning.mutateAsync({
        date: form.date,
        amount,
        km,
        duration_min: durationMin,
        note: form.note,
      });
      setForm({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        km: '',
        durationMin: '',
        note: '',
      });
      toast.success('Entrée ajoutée');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Impossible d'ajouter l'entrée"));
    }
  };

  const [experimentMode, setExperimentMode] = useState(() => {
    return localStorage.getItem('geohustle_experiment_mode') === 'true';
  });

  const startTrip = useCallback(() => {
    if (!userLocation) {
      toast.error('GPS non disponible');
      return;
    }
    setTripStart({
      lat: userLocation.latitude,
      lng: userLocation.longitude,
      time: Date.now(),
    });
    setTripActive(true);
    setTripElapsed(0);
    window.dispatchEvent(new Event('trip-start'));
  }, [userLocation]);

  const endTrip = useCallback(async () => {
    if (!tripStart || !userLocation) return;
    const km = haversineKm(
      tripStart.lat,
      tripStart.lng,
      userLocation.latitude,
      userLocation.longitude
    );
    const durationMin = Math.round((Date.now() - tripStart.time) / 60_000);
    setTripActive(false);
    window.dispatchEvent(new Event('trip-end'));

    try {
      await addEarning.mutateAsync({
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        km: Math.round(km * 10) / 10,
        duration_min: durationMin,
        note: `Auto-trajet: ${km.toFixed(1)} km, ${durationMin} min${experimentMode ? ' [EXP]' : ''}`,
      });
      toast.success(
        `Trajet enregistré: ${km.toFixed(1)} km, ${durationMin} min`
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Impossible d'enregistrer le trajet"));
    }
    setTripStart(null);
  }, [tripStart, userLocation, addEarning, experimentMode]);

  const exportCSV = useCallback(() => {
    if (earnings.length === 0) return;
    const header = 'Date,Montant,Km,Durée(min),Note\n';
    const rows = earnings
      .map((e) => `${e.date},${e.amount},${e.km},${e.duration_min},"${e.note}"`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earnings-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [earnings, period]);

  const formatDwell = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const formatTrip = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/30 bg-amber-500/10">
        <CardContent className="px-4 py-3 text-sm text-amber-100 space-y-1">
          <p className="font-medium text-foreground">Mode taxi local</p>
          <p>
            Ce module reste stocké dans ce navigateur et ne nourrit pas encore
            la base principale de Delivroom.
          </p>
          <p>
            Le $/heure affiché plus bas reflète seulement le temps de trajet
            enregistré ici, pas tout le temps d’attente ou de shift.
          </p>
        </CardContent>
      </Card>

      {/* Dwell Timer */}
      {nearbyZone && (
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-5 h-5 text-primary" />
              <span className="text-[16px] font-display font-bold">
                📍 Vous êtes à {nearbyZone.zone.name}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-muted-foreground font-body">
                Attente estimée: {estimatedWait} · Score: {nearbyZone.score}
              </span>
              <span className="text-[20px] font-display font-bold text-primary">
                {formatDwell(dwellSeconds)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mileage Tracker */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-[16px] font-display flex items-center gap-2">
            <Car className="w-4 h-4 text-primary" /> Suivi kilométrique
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tripActive ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-primary/10 rounded-lg px-4 py-3">
                <span className="text-[14px] font-body">
                  Trajet en cours...
                </span>
                <span className="text-[24px] font-display font-bold text-primary">
                  <Clock className="w-4 h-4 inline mr-1" />
                  {formatTrip(tripElapsed)}
                </span>
              </div>
              <Button
                onClick={endTrip}
                variant="destructive"
                className="w-full h-14 text-[16px] font-display font-bold gap-2"
              >
                <Square className="w-4 h-4" /> Terminer trajet
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-background rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-primary" />
                  <span className="text-[13px] font-body">
                    Shift expérimental
                  </span>
                </div>
                <Switch
                  checked={experimentMode}
                  onCheckedChange={(v) => {
                    setExperimentMode(v);
                    localStorage.setItem(
                      'geohustle_experiment_mode',
                      String(v)
                    );
                  }}
                />
              </div>
              <Button
                onClick={startTrip}
                className="w-full h-14 text-[16px] font-display font-bold gap-2 bg-primary text-primary-foreground"
              >
                <Play className="w-4 h-4" /> Démarrer trajet
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cash Earnings Tracker */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-[16px] font-display flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" /> Revenus cash
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="bg-background border-border text-[14px]"
            />
            <Input
              type="number"
              placeholder="Montant $"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
              className="bg-background border-border text-[14px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Km"
              value={form.km}
              onChange={(e) => setForm((f) => ({ ...f, km: e.target.value }))}
              className="bg-background border-border text-[14px]"
            />
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Durée active (min)"
              value={form.durationMin}
              onChange={(e) =>
                setForm((f) => ({ ...f, durationMin: e.target.value }))
              }
              className="bg-background border-border text-[14px]"
            />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <Input
              placeholder="Note"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              className="bg-background border-border text-[14px]"
            />
          </div>
          <Button
            onClick={handleAddEntry}
            className="w-full h-12 text-[14px] font-display font-bold gap-2"
            disabled={addEarning.isPending}
          >
            <DollarSign className="w-4 h-4" /> Ajouter entrée
          </Button>

          {/* Period selector + totals */}
          <div className="flex gap-1 pt-2 border-t border-border">
            {(['day', 'week', 'month'] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? 'default' : 'outline'}
                onClick={() => setPeriod(p)}
                className="flex-1 text-[12px]"
              >
                {p === 'day' ? 'Jour' : p === 'week' ? 'Semaine' : 'Mois'}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-background rounded-lg px-3 py-2 border border-border">
              <span className="text-[12px] text-muted-foreground block">
                Total
              </span>
              <span className="text-[20px] font-display font-bold text-primary">
                ${totals.amount.toFixed(2)}
              </span>
            </div>
            <div className="bg-background rounded-lg px-3 py-2 border border-border">
              <span className="text-[12px] text-muted-foreground block">
                Km total
              </span>
              <span className="text-[20px] font-display font-bold">
                {totals.km.toFixed(1)}
              </span>
            </div>
            <div className="bg-background rounded-lg px-3 py-2 border border-border">
              <span className="text-[12px] text-muted-foreground block">
                $/km
              </span>
              <span className="text-[18px] font-display font-bold">
                ${totals.perKm.toFixed(2)}
              </span>
            </div>
            <div className="bg-background rounded-lg px-3 py-2 border border-border">
              <span className="text-[12px] text-muted-foreground block">
                $/heure actif
              </span>
              <span className="text-[18px] font-display font-bold">
                ${totals.perHour.toFixed(2)}
              </span>
            </div>
          </div>

          <Button
            onClick={exportCSV}
            variant="outline"
            className="w-full h-12 gap-2 text-[14px]"
            disabled={earnings.length === 0}
          >
            <Download className="w-4 h-4" /> Exporter CSV ({earnings.length}{' '}
            entrées)
          </Button>
        </CardContent>
      </Card>

      {/* Flat Rate Reference */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-[16px] font-display flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> Tarifs fixes Montréal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 gap-1 text-[11px] text-muted-foreground font-body font-medium px-1 pb-1 border-b border-border">
              <span>De</span>
              <span>À</span>
              <span>Jour</span>
              <span>Nuit</span>
            </div>
            {FLAT_RATES.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-4 gap-1 text-[13px] font-body px-1 py-1.5 rounded hover:bg-accent/20"
              >
                <span className="truncate">{r.from}</span>
                <span className="truncate">{r.to}</span>
                <span className="font-display font-bold">
                  ${r.day.toFixed(2)}
                </span>
                <span className="font-display font-bold text-muted-foreground">
                  ${r.night.toFixed(2)}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground pt-1">
              Jour: 5h-23h · Nuit: 23h-5h
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
