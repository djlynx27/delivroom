import { useMemo, useState } from 'react';
import {
  AddressSearchBox,
  type AddressSearchResult,
} from '@/components/drive/AddressSearchBox';
import { ProspectingStepper } from '@/components/drive/ProspectingStepper';
import { useCityId } from '@/hooks/useCityId';
import { useDemandScores } from '@/hooks/useDemandScores';
import { useUserLocation } from '@/hooks/useUserLocation';
import { logNavEvent, type RouteCandidateZone } from '@/services/routing';
import {
  buildProspectingSteps,
  type ProspectingStep,
} from '@/services/routing/prospectingSteps';

// Lab-only tab: type an address, Enter/tap a suggestion, get the ordered hot
// stops on the way. Each stop opens Google Maps on its own (hop-by-hop).
export default function ProspectionScreen() {
  const [cityId] = useCityId();
  const { location } = useUserLocation();
  const { zones, scores } = useDemandScores(cityId, {
    currentLat: location?.latitude ?? null,
    currentLng: location?.longitude ?? null,
  });
  const [trip, setTrip] = useState<{
    destinationName: string;
    steps: ProspectingStep[];
    activeIndex: number;
  } | null>(null);

  const candidates = useMemo<RouteCandidateZone[]>(
    () =>
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        latitude: z.latitude,
        longitude: z.longitude,
        score: scores.get(z.id) ?? 0,
        type: z.type,
      })),
    [zones, scores]
  );
  const origin = location
    ? { lat: location.latitude, lng: location.longitude }
    : null;

  function handleSelect(result: AddressSearchResult) {
    if (!origin) return;
    setTrip({
      destinationName: result.name,
      steps: buildProspectingSteps(origin, { ...result, score: 0 }, candidates),
      activeIndex: 0,
    });
  }

  function launch(index: number) {
    const step = trip?.steps[index];
    if (!trip || !step) return;
    logNavEvent(origin, step.zone, 'prospection');
    setTrip({ ...trip, activeIndex: index + 1 });
    window.location.href = step.url;
  }

  return (
    <div className="pb-24">
      <div className="px-4 pt-2 pb-3">
        <AddressSearchBox
          onSelect={handleSelect}
          proximity={
            location
              ? { latitude: location.latitude, longitude: location.longitude }
              : undefined
          }
        />
      </div>
      {!origin && (
        <p className="px-4 text-sm text-muted-foreground">
          En attente du GPS…
        </p>
      )}
      {trip ? (
        <ProspectingStepper
          destinationName={trip.destinationName}
          steps={trip.steps}
          activeIndex={trip.activeIndex}
          onLaunch={launch}
          onClose={() => setTrip(null)}
        />
      ) : (
        origin && (
          <p className="px-4 text-sm text-muted-foreground">
            Tape une destination — Delivroom te propose les zones chaudes sur
            le chemin, une étape à la fois.
          </p>
        )
      )}
    </div>
  );
}
