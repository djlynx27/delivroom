import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useZones } from '@/hooks/useSupabase';
import { useAddTrip, useTrips } from '@/hooks/useTrips';
import { validateTripEntryForm } from '@/lib/tripEntryValidation';
import {
  Clock,
  DollarSign,
  Loader2,
  MapPin,
  Plus,
  Smartphone,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

function scoreToPredictedEarningsPerHour(score: number): number {
  return Math.max(12, 12 + score * 0.42);
}

export function TripLogger() {
  const { data: zones = [] } = useZones('mtl');
  const { data: lavalZones = [] } = useZones('laval');
  const { data: longueuilZones = [] } = useZones('longueuil');
  const allZones = [...zones, ...lavalZones, ...longueuilZones];

  const { data: recentTrips = [] } = useTrips(10);
  const addTrip = useAddTrip();

  const today = new Date().toISOString().split('T')[0]!;
  const [form, setForm] = useState({
    zone_id: '',
    date: today,
    start_time: '08:00',
    end_time: '09:00',
    earnings: '',
    tips: '',
    distance_km: '',
    notes: '',
    platform: '',
  });

  function updateField(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit() {
    const validation = validateTripEntryForm(form);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    const { earnings, tips, distanceKm } = validation.values;
    const selectedZone = allZones.find((zone) => zone.id === form.zone_id);
    const zoneScore = Math.round(Number(selectedZone?.current_score ?? 50));
    const started_at = `${form.date}T${form.start_time}:00`;
    const ended_at = `${form.date}T${form.end_time}:00`;
    await addTrip.mutateAsync({
      trip: {
        zone_id: form.zone_id,
        started_at,
        ended_at,
        earnings,
        tips,
        distance_km: distanceKm,
        notes: form.notes.trim().slice(0, 500),
        platform: form.platform || null,
        zone_score: zoneScore,
      },
      feedback: {
        zoneScore,
        predictedEarningsPerH: scoreToPredictedEarningsPerHour(zoneScore),
      },
    });
    setForm((f) => ({
      ...f,
      earnings: '',
      tips: '',
      distance_km: '',
      notes: '',
    }));
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('fr-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" /> Journal de courses
        </CardTitle>
        <CardDescription className="text-xs">
          Enregistrer manuellement une course
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Zone select */}
        <Select
          value={form.zone_id}
          onValueChange={(v) => updateField('zone_id', v)}
        >
          <SelectTrigger className="bg-background border-border">
            <SelectValue placeholder="Sélectionner une zone" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-60">
            {allZones.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.name} —{' '}
                <span className="text-muted-foreground capitalize">
                  {z.type}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date + times */}
        <div className="grid grid-cols-3 gap-2">
          <Input
            type="date"
            value={form.date}
            onChange={(e) => updateField('date', e.target.value)}
            className="bg-background border-border"
          />
          <Input
            type="time"
            value={form.start_time}
            onChange={(e) => updateField('start_time', e.target.value)}
            className="bg-background border-border"
          />
          <Input
            type="time"
            value={form.end_time}
            onChange={(e) => updateField('end_time', e.target.value)}
            className="bg-background border-border"
          />
        </div>

        {/* Platform */}
        <Select
          value={form.platform}
          onValueChange={(v) => updateField('platform', v)}
        >
          <SelectTrigger className="bg-background border-border">
            <SelectValue placeholder="Plateforme (Uber, Lyft, Skip...)" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-60">
            <SelectItem value="uber">Uber</SelectItem>
            <SelectItem value="lyft">Lyft</SelectItem>
            <SelectItem value="skip">SkipTheDishes</SelectItem>
            <SelectItem value="doordash">DoorDash</SelectItem>
            <SelectItem value="eva">Eva</SelectItem>
            <SelectItem value="taxi">Taxi / Taxi Fantôme</SelectItem>
            <SelectItem value="other">Autre</SelectItem>
          </SelectContent>
        </Select>

        {/* Earnings + tips + distance */}
        <div className="grid grid-cols-3 gap-2">
          <Input
            type="number"
            step="0.01"
            placeholder="Gains $"
            value={form.earnings}
            onChange={(e) => updateField('earnings', e.target.value)}
            className="bg-background border-border"
          />
          <Input
            type="number"
            step="0.01"
            placeholder="Tips $"
            value={form.tips}
            onChange={(e) => updateField('tips', e.target.value)}
            className="bg-background border-border"
          />
          <Input
            type="number"
            step="0.1"
            placeholder="km"
            value={form.distance_km}
            onChange={(e) => updateField('distance_km', e.target.value)}
            className="bg-background border-border"
          />
        </div>

        {/* Notes */}
        <Textarea
          placeholder="Notes (optionnel)"
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          className="bg-background border-border h-16 resize-none"
          maxLength={500}
        />

        <Button
          onClick={handleSubmit}
          className="w-full gap-2"
          disabled={addTrip.isPending}
        >
          {addTrip.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Enregistrer la course
        </Button>

        {/* Recent trips */}
        {recentTrips.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs font-medium text-foreground">
              10 dernières courses
            </p>
            {recentTrips.map((trip) => (
              <div
                key={trip.id}
                className="bg-background rounded-lg border border-border p-2.5 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-display font-semibold truncate">
                    {trip.zones?.name || 'Zone inconnue'}
                  </span>
                  <div className="flex items-center gap-1">
                    {trip.platform && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        <Smartphone className="w-3 h-3 mr-0.5" />
                        {String(trip.platform)}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs shrink-0">
                      <DollarSign className="w-3 h-3 mr-0.5" />
                      {Number(trip.earnings || 0).toFixed(2)}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(trip.started_at)}–
                    {trip.ended_at ? formatTime(trip.ended_at) : '?'}
                  </span>
                  {(trip.distance_km ?? 0) > 0 && (
                    <span>{Number(trip.distance_km).toFixed(1)} km</span>
                  )}
                  {(trip.tips ?? 0) > 0 && (
                    <span>+${Number(trip.tips).toFixed(2)} tips</span>
                  )}
                </div>
                {trip.notes && (
                  <p className="text-xs text-muted-foreground italic truncate">
                    {trip.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
