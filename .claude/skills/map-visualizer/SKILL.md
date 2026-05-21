---
name: map-visualizer
description: Cartes interactives avec Mapbox, Leaflet ou deck.gl pour heatmaps, zones colorees, marqueurs dynamiques, polygones. Utilise ce skill des que l'utilisateur veut afficher des donnees geographiques, creer une carte de chaleur, visualiser des zones de demande, ou integrer une carte dans son app React. Directement applicable pour Delivroom/ZonePilote.
---

# Map Visualizer

Cartes interactives avec donnees geospatiales pour Delivroom.

## Stack recommandee

| Option | Token requis | Usage |
|---|---|---|
| **Mapbox GL JS** | Oui (gratuit 50k req/mois) | Cartes premium, heatmaps avancees |
| **Leaflet + react-leaflet** | Non | Carte fonctionnelle sans cles |
| **deck.gl** | Non | Visualisations 3D et heatmaps performantes |

## Mapbox + React

```bash
npm install mapbox-gl react-map-gl @types/mapbox-gl
```

```tsx
// components/DemandMap.tsx
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useState } from 'react'

const MONTREAL = { longitude: -73.5673, latitude: 45.5017, zoom: 11 }

export function DemandMap({ zones, scores }: Props) {
  const [popup, setPopup] = useState<Zone | null>(null)

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map(zone => ({
      type: 'Feature',
      properties: { zone_id: zone.id, name: zone.name, score: scores[zone.id] ?? 0 },
      geometry: { type: 'Point', coordinates: [zone.lon, zone.lat] }
    }))
  }

  return (
    <Map
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
      initialViewState={MONTREAL}
      style={{ width: '100%', height: '100vh' }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    >
      <Source id="demand" type="geojson" data={geojson}>
        <Layer
          id="demand-heat"
          type="heatmap"
          paint={{
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'score'], 0, 0, 10, 1],
            'heatmap-intensity': 1.5,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,255,0)',
              0.3, '#22c55e',
              0.6, '#f97316',
              1.0, '#ef4444'
            ],
            'heatmap-radius': 40,
            'heatmap-opacity': 0.7,
          }}
        />
      </Source>

      {zones.map(zone => (
        <Marker key={zone.id} longitude={zone.lon} latitude={zone.lat} onClick={() => setPopup(zone)}>
          <ScoreMarker score={scores[zone.id] ?? 0} />
        </Marker>
      ))}

      {popup && (
        <Popup longitude={popup.lon} latitude={popup.lat} onClose={() => setPopup(null)}>
          <strong>{popup.name}</strong>
          <div>Score: {(scores[popup.id] ?? 0).toFixed(1)}/10</div>
        </Popup>
      )}
    </Map>
  )
}

function ScoreMarker({ score }: { score: number }) {
  const color = score >= 7 ? '#ef4444' : score >= 5 ? '#f97316' : score >= 3 ? '#eab308' : '#22c55e'
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: color, border: '2px solid white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, color: 'white', cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
    }}>
      {score.toFixed(0)}
    </div>
  )
}
```

## Zones polygones colorees par score

```tsx
<Source id="zones-poly" type="geojson" data={zonesGeoJSON}>
  <Layer
    id="zones-fill"
    type="fill"
    paint={{
      'fill-color': [
        'interpolate', ['linear'], ['get', 'score'],
        0, '#22c55e', 5, '#f97316', 10, '#ef4444'
      ],
      'fill-opacity': 0.4,
    }}
  />
  <Layer id="zones-border" type="line"
    paint={{ 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.6 }}
  />
</Source>
```

## Leaflet (sans token Mapbox)

```tsx
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const scoreColor = (s: number) => s >= 7 ? '#ef4444' : s >= 5 ? '#f97316' : '#22c55e'

<MapContainer center={[45.5017, -73.5673]} zoom={11} style={{ height: '100vh' }}>
  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
  {zones.map(zone => (
    <CircleMarker
      key={zone.id}
      center={[zone.lat, zone.lon]}
      radius={scores[zone.id] * 2.5 + 8}
      color={scoreColor(scores[zone.id] ?? 0)}
      fillOpacity={0.7}
    >
      <Popup>{zone.name} - Score: {(scores[zone.id] ?? 0).toFixed(1)}</Popup>
    </CircleMarker>
  ))}
</MapContainer>
```

## GPS chauffeur en temps reel

```typescript
useEffect(() => {
  if (!navigator.geolocation) return
  const watchId = navigator.geolocation.watchPosition(
    (pos) => setDriverPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    (err) => console.error('GPS:', err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  )
  return () => navigator.geolocation.clearWatch(watchId)
}, [])
```

## Limites Mapbox plan gratuit

- 50 000 requetes de tuiles/mois
- Geocodage: 100 000 req/mois
- Directions: 100 000 req/mois
- Au-dela: ~0.50$/1000 req
