import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import {
  forwardGeocode,
  suggestZoneName,
  suggestZoneSlug,
} from '@/lib/geocoding';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  Navigation,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const ZONE_TYPES = [
  'résidentiel',
  'commercial',
  'transport',
  'métro',
  'aéroport',
  'médical',
  'université',
  'événements',
  'tourisme',
  'nightlife',
] as const;

type ZoneType = (typeof ZONE_TYPES)[number];

interface DiscoveryRow {
  id: string;
  address: string;
  context: 'pickup' | 'dropoff' | 'other';
  city_hint: string | null;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: 'pending' | 'promoted' | 'rejected';
  promoted_zone_id: string | null;
}

async function fetchDiscoveries(): Promise<DiscoveryRow[]> {
  const { data, error } = await supabase
    .from('zone_discoveries')
    .select('id, address, context, city_hint, count, first_seen_at, last_seen_at, status, promoted_zone_id')
    .order('count', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as DiscoveryRow[];
}

export default function AdminZoneDiscoveriesScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [target, setTarget] = useState<DiscoveryRow | null>(null);

  const { data: discoveries = [], isLoading } = useQuery({
    queryKey: ['zone-discoveries'],
    queryFn: fetchDiscoveries,
  });

  const visible = discoveries.filter((d) => (filter === 'pending' ? d.status === 'pending' : true));

  return (
    <AdminPageShell
      title="Zones découvertes"
      description="Adresses que l'IA a vues dans tes screenshots mais qui ne sont pas dans ton catalog. Promouvoir en vraie zone pour enrichir le scoring."
    >
      <div className="flex items-center gap-2">
        <Button
          variant={filter === 'pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('pending')}
        >
          À traiter ({discoveries.filter((d) => d.status === 'pending').length})
        </Button>
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          Tout ({discoveries.length})
        </Button>
      </div>

      {isLoading && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Chargement…
          </CardContent>
        </Card>
      )}

      {!isLoading && visible.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Aucune découverte {filter === 'pending' ? 'en attente' : ''}. Upload des screenshots pour
            que l'IA collecte des adresses absentes du catalog.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {visible.map((d) => (
          <Card key={d.id} className="bg-card border-border">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-2">
                {d.context === 'pickup' ? (
                  <Navigation className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <MapPin className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{d.address}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px]">{d.context}</Badge>
                    {d.city_hint && <Badge variant="outline" className="text-[10px]">{d.city_hint}</Badge>}
                    <Badge variant="secondary" className="text-[10px]">vu {d.count}×</Badge>
                    {d.status === 'promoted' && (
                      <Badge className="text-[10px] bg-green-500/15 text-green-400 border border-green-500/30 gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        promu → {d.promoted_zone_id}
                      </Badge>
                    )}
                  </div>
                </div>
                {d.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 shrink-0"
                    onClick={() => setTarget(d)}
                  >
                    Promouvoir <ArrowRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PromoteDialog
        discovery={target}
        onClose={() => setTarget(null)}
        onSuccess={() => {
          setTarget(null);
          qc.invalidateQueries({ queryKey: ['zone-discoveries'] });
        }}
      />
    </AdminPageShell>
  );
}

interface PromoteDialogProps {
  discovery: DiscoveryRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

function PromoteDialog({ discovery, onClose, onSuccess }: PromoteDialogProps) {
  const [zoneSlug, setZoneSlug] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [cityId, setCityId] = useState('');
  const [zoneType, setZoneType] = useState<ZoneType>('résidentiel');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [matchedAddress, setMatchedAddress] = useState<string | null>(null);

  // Pre-fill defaults when a discovery is selected
  useEffect(() => {
    if (!discovery) return;
    setZoneSlug(suggestZoneSlug(discovery.address));
    setZoneName(suggestZoneName(discovery.address));
    setCityId(discovery.city_hint ?? '');
    setZoneType('résidentiel');
    setLat('');
    setLng('');
    setMatchedAddress(null);
  }, [discovery]);

  async function autoGeocode() {
    if (!discovery) return;
    setGeocoding(true);
    try {
      const result = await forwardGeocode(discovery.address);
      if (!result) {
        toast.error('Mapbox n\'a rien trouvé pour cette adresse');
        return;
      }
      setLat(result.latitude.toFixed(6));
      setLng(result.longitude.toFixed(6));
      setMatchedAddress(result.matchedAddress);
      toast.success(`Géocodé (confiance ${(result.confidence * 100).toFixed(0)}%)`);
    } finally {
      setGeocoding(false);
    }
  }

  async function submit() {
    if (!discovery) return;
    if (!cityId || !zoneSlug || !zoneName || !lat || !lng) {
      toast.error('Tous les champs sont requis');
      return;
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      toast.error('Latitude / longitude invalides');
      return;
    }
    const zoneId = `${cityId}-${zoneSlug}`;
    setSubmitting(true);
    try {
      // 1. Create the zone
      const { error: insertErr } = await supabase.from('zones').insert({
        id: zoneId,
        city_id: cityId,
        name: zoneName,
        type: zoneType,
        latitude: latNum,
        longitude: lngNum,
        address: discovery.address,
        base_score: 50,
        current_score: 50,
      });
      if (insertErr) {
        toast.error(`Échec création zone : ${insertErr.message}`);
        return;
      }

      // 2. Mark discovery as promoted
      const { error: updErr } = await supabase
        .from('zone_discoveries')
        .update({ status: 'promoted', promoted_zone_id: zoneId })
        .eq('id', discovery.id);
      if (updErr) {
        toast.warning(`Zone créée mais échec màj discovery : ${updErr.message}`);
      }

      toast.success(`Zone ${zoneId} créée`);
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!discovery} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Promouvoir en zone</DialogTitle>
          <DialogDescription className="break-words">
            {discovery?.address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">city_id</Label>
              <Input value={cityId} onChange={(e) => setCityId(e.target.value.toLowerCase())} placeholder="mtl" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">slug (id suffix)</Label>
              <Input value={zoneSlug} onChange={(e) => setZoneSlug(e.target.value.toLowerCase())} placeholder="pitfield-valiquette" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Nom affiché</Label>
            <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={zoneType} onValueChange={(v) => setZoneType(v as ZoneType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Coordonnées GPS</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={autoGeocode}
                disabled={geocoding}
              >
                {geocoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Géocoder via Mapbox
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="latitude" />
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="longitude" />
            </div>
            {matchedAddress && (
              <p className="text-[10px] text-muted-foreground italic break-words">
                Mapbox a matché : {matchedAddress}
              </p>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">
            ID final : <span className="font-mono">{cityId || '?'}-{zoneSlug || '?'}</span>. Score
            initial : 50.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Annuler</Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Créer la zone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
