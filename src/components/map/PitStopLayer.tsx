import { PIT_STOPS, type PitStop } from '@/lib/pitStops';
import type { RankedStation } from '@/lib/gasRanking';
import { Marker } from 'react-map-gl';

export interface PitStopLayerProps {
  visible: boolean;
  /** Best-priced nearby gas station (useGasBoard), if any — shown alongside
   * the curated restroom list rather than a static price. */
  bestGasStation: RankedStation | null;
  onSelectRestroom: (stop: PitStop) => void;
  onSelectGas: (station: RankedStation) => void;
}

/**
 * Pit-stop markers for the Drive nav map: 24/7 restrooms (curated list) plus
 * the best-priced gas station nearby (live, from useGasBoard). Tapping a
 * marker is a 1-tap waypoint add — see PitStopToggle's caller for the
 * Google Maps handoff.
 */
export function PitStopLayer({
  visible,
  bestGasStation,
  onSelectRestroom,
  onSelectGas,
}: PitStopLayerProps) {
  if (!visible) return null;

  return (
    <>
      {PIT_STOPS.map((stop) => (
        <Marker
          key={stop.id}
          longitude={stop.longitude}
          latitude={stop.latitude}
          anchor="bottom"
        >
          <button
            onClick={() => onSelectRestroom(stop)}
            aria-label={stop.name}
            className="flex flex-col items-center"
          >
            <span
              style={{ fontSize: '22px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}
            >
              🚻
            </span>
          </button>
        </Marker>
      ))}

      {bestGasStation && (
        <Marker
          longitude={bestGasStation.lng}
          latitude={bestGasStation.lat}
          anchor="bottom"
        >
          <button
            onClick={() => onSelectGas(bestGasStation)}
            aria-label={`${bestGasStation.name} — meilleur prix`}
            className="flex flex-col items-center"
          >
            <span
              style={{ fontSize: '22px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}
            >
              ⛽
            </span>
          </button>
        </Marker>
      )}
    </>
  );
}
