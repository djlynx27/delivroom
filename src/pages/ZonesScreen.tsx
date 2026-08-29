import { CitySelect } from '@/components/CitySelect';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ZonePerformanceHeatmap } from '@/components/ZonePerformanceHeatmap';
import { useI18n } from '@/contexts/I18nContext';
import { useAutoCity } from '@/hooks/useAutoCity';
import { useCityId } from '@/hooks/useCityId';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import {
  useAddZone,
  useCities,
  useDeleteZone,
  useUpdateZone,
  useZones,
  type Zone,
} from '@/hooks/useSupabase';
import { useUserLocation } from '@/hooks/useUserLocation';
import { Constants } from '@/integrations/supabase/types';
import { parseZoneCoordinates } from '@/lib/zoneCoordinates';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { toast } from 'sonner';
const MapboxHeatmap = lazy(() => import('@/components/MapboxHeatmap'));

const ZONE_TYPES = Constants.public.Enums.zone_type;
type ZoneType = (typeof ZONE_TYPES)[number];

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const CITY_CENTERS: Record<string, [number, number]> = {
  mtl: [45.5017, -73.5673],
  lvl: [45.5503, -73.7006],
  lng: [45.5252, -73.5205],
  bsb: [45.6202, -73.8428],
  sth: [45.6422, -73.8295],
  blv: [45.675, -73.8779],
  rsm: [45.6365, -73.7993],
  trb: [45.7017, -73.6449],
};

export default function ZonesScreen() {
  usePullToRefresh(() => window.location.reload());
  const { t } = useI18n();
  const [cityId, setCityId] = useCityId();
  const { location: userLocation } = useUserLocation();
  useAutoCity(
    cityId,
    setCityId,
    userLocation?.latitude,
    userLocation?.longitude
  );
  const { data: cities = [] } = useCities();
  const { data: zones = [] } = useZones(cityId);
  const addZone = useAddZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();

  const [editing, setEditing] = useState<Zone | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    name: '',
    type: 'commercial' as string,
    latitude: '',
    longitude: '',
  });

  function openAdd() {
    setEditing(null);
    setForm({ name: '', type: 'commercial', latitude: '', longitude: '' });
    setShowDialog(true);
  }

  function openEdit(zone: Zone) {
    setEditing(zone);
    setForm({
      name: zone.name,
      type: zone.type,
      latitude: String(zone.latitude),
      longitude: String(zone.longitude),
    });
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.name || !form.latitude || !form.longitude) return;

    const coordinates = parseZoneCoordinates(form.latitude, form.longitude);
    if (!coordinates) {
      toast.error(
        'Coordonnees invalides: utilise des nombres valides pour latitude et longitude'
      );
      return;
    }

    try {
      if (editing) {
        await updateZone.mutateAsync({
          id: editing.id,
          name: form.name,
          type: form.type,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        });
      } else {
        // zones.id has no DB default (NOT NULL, no sequence/uuid default) —
        // matches the "cityprefix-slug" convention used by every seeded zone.
        const slug = form.name
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        await addZone.mutateAsync({
          id: `${cityId}-${slug}`,
          city_id: cityId,
          name: form.name,
          type: form.type as ZoneType,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        });
      }
      toast.success(t('save'));
      setShowDialog(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('save')));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteZone.mutateAsync(id);
      toast.success(t('deleteZone'));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('deleteZone')));
    }
  }

  const mapCenter =
    zones.length > 0
      ? ([zones[0]!.latitude, zones[0]!.longitude] as [number, number])
      : (CITY_CENTERS[cityId] ?? CITY_CENTERS.mtl!);

  const filteredZones = search.trim()
    ? zones.filter(
        (z) =>
          z.name.toLowerCase().includes(search.trim().toLowerCase()) ||
          z.type.toLowerCase().includes(search.trim().toLowerCase())
      )
    : zones;

  const mapMarkers = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    type: zone.type,
    latitude: zone.latitude,
    longitude: zone.longitude,
  }));

  return (
    <div className="flex flex-col h-full pb-36">
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-display font-bold">{t('zones')}</h1>
          <Button size="sm" onClick={openAdd} className="gap-1">
            <Plus className="w-4 h-4" /> {t('addZone')}
          </Button>
        </div>
        <CitySelect cities={cities} value={cityId} onChange={setCityId} />
        <Input
          placeholder={`🔍 ${t('searchZone')}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background border-border h-10"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="relative z-[1] h-[220px] w-full overflow-hidden rounded-lg border border-border">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Chargement de la carte…
              </div>
            }
          >
            <MapboxHeatmap center={mapCenter} zoom={11} markers={mapMarkers} />
          </Suspense>
        </div>

        {/* Performance Heatmap */}
        <div className="relative z-[1] mt-4">
          <ZonePerformanceHeatmap zones={zones} />
        </div>

        <hr className="my-5 border-border" />

        <div className="relative z-[1] flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-display font-bold">
            Gestion des zones ({filteredZones.length})
          </h2>
        </div>

        <div className="relative z-[1] space-y-2">
          {filteredZones.length === 0 && search.trim() && (
            <p className="text-[14px] text-muted-foreground font-body text-center py-4">
              {t('noResults')}
            </p>
          )}
          {filteredZones.map((zone) => (
            <div
              key={zone.id}
              className="flex items-center justify-between bg-card rounded-md border border-border px-3 py-2 gap-2 transition-colors hover:bg-accent/10"
            >
              <div className="min-w-0">
                <span className="text-sm font-display font-medium break-words block">
                  {zone.name}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {zone.type}
                </span>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(zone)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(zone.id)}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? t('editZone') : t('addZone')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {editing
                ? 'Modifiez le nom, le type et la position de la zone avant de sauvegarder.'
                : 'Ajoutez une nouvelle zone avec son type et ses coordonnees pour l afficher sur la carte.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder={t('name')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="bg-background border-border"
            />
            <Select
              value={form.type}
              onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {ZONE_TYPES.map((zoneType) => (
                  <SelectItem key={zoneType} value={zoneType}>
                    {zoneType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder={t('latitude')}
                value={form.latitude}
                onChange={(e) =>
                  setForm((f) => ({ ...f, latitude: e.target.value }))
                }
                className="bg-background border-border"
              />
              <Input
                placeholder={t('longitude')}
                value={form.longitude}
                onChange={(e) =>
                  setForm((f) => ({ ...f, longitude: e.target.value }))
                }
                className="bg-background border-border"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleSave}>{t('save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
