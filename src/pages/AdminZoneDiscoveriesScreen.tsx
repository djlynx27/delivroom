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
import { Progress } from '@/components/ui/progress';
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
  guessCityIdFromText,
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

// supabase.functions.invoke() reports non-2xx as a generic "Edge Function
// returned a non-2xx status code"; the real reason is in the Response body.
// Pull it out so the driver sees what actually failed.
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (typeof body?.error === 'string') return body.error;
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export default function AdminZoneDiscoveriesScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [target, setTarget] = useState<DiscoveryRow | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const { data: discoveries = [], isLoading } = useQuery({
    queryKey: ['zone-discoveries'],
    queryFn: fetchDiscoveries,
  });

  // Promote every pending discovery at once: geocode each via Mapbox, derive
  // city + name + a collision-free zone id, and create it through the
  // service-role Edge Function. Sequential (Mapbox + insert per item) so it
  // needs the app to stay foreground; unresolvable rows (no geocode / no city)
  // are skipped and reported. NOTE: this can create a lot of intersection-level
  // zones — fine if that's what you want, but the city fallback already places
  // these rides, so promoting only the recurring ones keeps scoring sharper.
  async function promoteAll() {
    const pending = discoveries.filter((d) => d.status === 'pending');
    if (pending.length === 0) return;
    if (
      !window.confirm(
        `Promouvoir les ${pending.length} adresses en zones ? Ça crée ~${pending.length} nouvelles zones (une par intersection).`
      )
    ) {
      return;
    }

    setBulk({ done: 0, total: pending.length });
    const usedIds = new Set<string>();
    let created = 0;
    let skipped = 0;
    try {
      for (const d of pending) {
        let city = d.city_hint ?? guessCityIdFromText(d.address);
        const geo = await forwardGeocode(d.address);
        if (!geo) {
          skipped += 1;
          setBulk({ done: created + skipped, total: pending.length });
          continue;
        }
        if (!city) city = guessCityIdFromText(geo.matchedAddress);
        if (!city) {
          skipped += 1;
          setBulk({ done: created + skipped, total: pending.length });
          continue;
        }
        const slug = suggestZoneSlug(d.address);
        let zoneId = `${city}-${slug}`;
        let n = 2;
        while (usedIds.has(zoneId)) zoneId = `${city}-${slug}-${n++}`;
        usedIds.add(zoneId);

        const { data, error } = await supabase.functions.invoke(
          'promote-discovery',
          {
            body: {
              action: 'promote',
              discovery_id: d.id,
              zone: {
                id: zoneId,
                city_id: city,
                name: suggestZoneName(d.address),
                type: 'résidentiel',
                latitude: geo.latitude,
                longitude: geo.longitude,
                address: d.address,
              },
            },
          }
        );
        if (error || (data as { error?: string })?.error) skipped += 1;
        else created += 1;
        setBulk({ done: created + skipped, total: pending.length });
      }
      qc.invalidateQueries({ queryKey: ['zone-discoveries'] });
      qc.invalidateQueries({ queryKey: ['zones'] });
      toast.success(
        `${created} zone(s) créée(s)${skipped ? ` · ${skipped} ignorée(s) (adresse non géocodable)` : ''}`
      );
    } finally {
      setBulk(null);
    }
  }

  async function rejectDiscovery(id: string) {
    setRejectingId(id);
    try {
      const { data, error } = await supabase.functions.invoke(
        'promote-discovery',
        { body: { action: 'reject', discovery_id: id } }
      );
      if (error) throw error;
      const payload = (data ?? {}) as { error?: string };
      if (payload.error) {
        toast.error(payload.error);
        return;
      }
      qc.invalidateQueries({ queryKey: ['zone-discoveries'] });
    } catch (err) {
      toast.error(await functionErrorMessage(err));
    } finally {
      setRejectingId(null);
    }
  }

  const visible = discoveries.filter((d) => (filter === 'pending' ? d.status === 'pending' : true));

  return (
    <AdminPageShell
      title="Zones découvertes"
      description="Adresses que l'IA a vues dans tes screenshots mais qui ne sont pas dans ton catalog. Promouvoir en vraie zone pour enrichir le scoring."
    >
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-3 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="text-foreground font-medium">Tu n'as pas à toutes les traiter.</span>{' '}
            Ce sont des intersections isolées ; tes courses y sont déjà placées
            approximativement (zone représentative de la ville).
          </p>
          <p>
            Promeus seulement les coins <span className="text-foreground font-medium">qui reviennent souvent</span> (vu
            plusieurs ×, triés en haut). Le GPS et la ville sont remplis
            automatiquement — tu n'as qu'à cliquer. <span className="text-foreground font-medium">Ignorer</span> vide
            le reste.
          </p>
        </CardContent>
      </Card>

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

      {(() => {
        const pendingCount = discoveries.filter(
          (d) => d.status === 'pending'
        ).length;
        if (pendingCount === 0) return null;
        return (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={promoteAll}
              disabled={!!bulk}
            >
              {bulk ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {bulk
                ? `Promotion… ${bulk.done}/${bulk.total}`
                : `Tout promouvoir (${pendingCount})`}
            </Button>
            {bulk && (
              <Progress
                value={(bulk.done / bulk.total) * 100}
                className="h-1.5"
              />
            )}
          </div>
        );
      })()}

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
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setTarget(d)}
                    >
                      Promouvoir <ArrowRight className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => rejectDiscovery(d.id)}
                      disabled={rejectingId === d.id}
                    >
                      {rejectingId === d.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Ignorer'
                      )}
                    </Button>
                  </div>
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

  // Pre-fill EVERYTHING when a discovery is selected: name/slug from the
  // address, city from the hint (or guessed from the text), and GPS auto-fetched
  // from Mapbox — so promoting is review-and-click, not a form the driver can't
  // fill.
  useEffect(() => {
    if (!discovery) return;
    const addr = discovery.address;
    setZoneSlug(suggestZoneSlug(addr));
    setZoneName(suggestZoneName(addr));
    setCityId(discovery.city_hint ?? guessCityIdFromText(addr) ?? '');
    setZoneType('résidentiel');
    setLat('');
    setLng('');
    setMatchedAddress(null);
    void runGeocode(addr, discovery.city_hint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovery]);

  async function runGeocode(
    address: string,
    cityHint: string | null,
    notify = false
  ) {
    setGeocoding(true);
    try {
      const result = await forwardGeocode(address);
      if (!result) {
        if (notify) toast.error('Mapbox n\'a rien trouvé pour cette adresse');
        return;
      }
      setLat(result.latitude.toFixed(6));
      setLng(result.longitude.toFixed(6));
      setMatchedAddress(result.matchedAddress);
      // Last-resort city from the Mapbox place_name if the address didn't tell us
      if (!cityHint && !guessCityIdFromText(address)) {
        const fromMatch = guessCityIdFromText(result.matchedAddress);
        if (fromMatch) setCityId(fromMatch);
      }
      if (notify) {
        toast.success(
          `Géocodé (confiance ${(result.confidence * 100).toFixed(0)}%)`
        );
      }
    } finally {
      setGeocoding(false);
    }
  }

  function autoGeocode() {
    if (!discovery) return;
    void runGeocode(discovery.address, discovery.city_hint, true);
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
      // zones + zone_discoveries are RLS read-only for the client, so the write
      // goes through the service-role promote-discovery Edge Function.
      const { data, error } = await supabase.functions.invoke(
        'promote-discovery',
        {
          body: {
            action: 'promote',
            discovery_id: discovery.id,
            zone: {
              id: zoneId,
              city_id: cityId,
              name: zoneName,
              type: zoneType,
              latitude: latNum,
              longitude: lngNum,
              address: discovery.address,
            },
          },
        }
      );
      if (error) throw error;
      const payload = (data ?? {}) as {
        error?: string;
        warning?: string;
        zone_id?: string;
      };
      if (payload.error) {
        toast.error(payload.error);
        return;
      }
      if (payload.warning) toast.warning(payload.warning);
      toast.success(`Zone ${zoneId} créée`);
      onSuccess();
    } catch (err) {
      toast.error(await functionErrorMessage(err));
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
