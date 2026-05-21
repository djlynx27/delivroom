---
name: demand-forecaster
description: Prévision de la demande de courses et livraisons pour chauffeurs gig, intégrant météo, événements, heure/jour et données historiques. Utilise ce skill dès que l'utilisateur veut prédire les zones chaudes, anticiper la demande, scorer des zones géographiques, ou construire un modèle de scoring de demande (comme dans Delivroom).
---

# Demand Forecaster

Modèle de scoring de demande pour chauffeurs gig — Grand Montréal.

## Architecture du scoring (Delivroom)

```
Score(zone, t) = Σ wi × facteur_i

Facteurs :
  f1 = time_of_day_factor      (poids: 0.35)
  f2 = day_of_week_factor      (poids: 0.20)
  f3 = weather_factor          (poids: 0.20)
  f4 = events_factor           (poids: 0.15)
  f5 = historical_factor       (poids: 0.10)

Score final normalisé : 0.0 – 10.0
```

## Facteur 1 — Heure de la journée

```python
TIME_FACTORS = {
    # (heure_debut, heure_fin): score
    (0, 3): 8.5,    # Sorties nocturnes
    (3, 6): 3.0,    # Creux nocturne
    (6, 9): 7.5,    # Rush matinal
    (9, 11): 5.5,   # Milieu matinée
    (11, 14): 6.5,  # Heure de lunch
    (14, 17): 5.0,  # Après-midi calme
    (17, 20): 8.0,  # Rush retour + dîner
    (20, 22): 7.0,  # Sorties dîner
    (22, 24): 8.0,  # Début soirée
}

def get_time_factor(hour: int) -> float:
    for (start, end), score in TIME_FACTORS.items():
        if start <= hour < end:
            return score / 10.0
    return 0.5
```

## Facteur 2 — Jour de la semaine

```python
DAY_FACTORS = {
    0: 0.65,  # Lundi
    1: 0.65,  # Mardi
    2: 0.70,  # Mercredi
    3: 0.75,  # Jeudi
    4: 0.90,  # Vendredi ★
    5: 1.00,  # Samedi ★★
    6: 0.80,  # Dimanche
}
```

## Facteur 3 — Météo (Open-Meteo)

```python
def weather_factor(weather_code: int, precip_mm: float, temp_c: float) -> float:
    """
    Codes WMO : 0 = ciel clair, 61-67 = pluie, 71-77 = neige, 95-99 = orage
    La pluie et la neige AUGMENTENT la demande (gens évitent de marcher)
    """
    base = 0.5
    
    # Précipitations → forte demande
    if precip_mm > 5: base += 0.4
    elif precip_mm > 1: base += 0.25
    elif precip_mm > 0: base += 0.1
    
    # Température extrême → demande accrue
    if temp_c < -15 or temp_c > 32: base += 0.2
    elif temp_c < -5 or temp_c > 28: base += 0.1
    
    # Orage → très forte demande
    if weather_code >= 95: base += 0.3
    
    return min(base, 1.0)
```

## Facteur 4 — Événements (Ticketmaster)

```python
def events_factor(events_nearby: list[dict], radius_km: float = 2.0) -> float:
    """
    Calcule l'impact d'événements dans un rayon donné.
    """
    if not events_nearby: return 0.0
    
    VENUE_CAPACITY_WEIGHTS = {
        "Bell Centre": 1.0,         # 21 000 places
        "Place Bell": 0.85,         # 10 000 places
        "Olympique": 0.9,           # 56 000 places
        "Saputo": 0.6,              # 20 000 places
        "Metropolis": 0.5,          # 2 500 places
        "MTelus": 0.4,              # 2 300 places
        "default": 0.3,
    }
    
    total_impact = 0.0
    for event in events_nearby:
        venue = event.get('venue_name', '')
        weight = next(
            (v for k, v in VENUE_CAPACITY_WEIGHTS.items() if k in venue),
            VENUE_CAPACITY_WEIGHTS['default']
        )
        # Impact décroît avec la distance
        dist = event.get('distance_km', 1.0)
        distance_decay = max(0, 1 - (dist / radius_km))
        total_impact += weight * distance_decay
    
    return min(total_impact, 1.0)
```

## Score composite

```python
def calculate_zone_score(
    lat: float, lon: float, 
    hour: int, day_of_week: int,
    weather: dict, events: list
) -> float:
    
    WEIGHTS = {
        'time': 0.35,
        'day': 0.20,
        'weather': 0.20,
        'events': 0.15,
        'historical': 0.10,
    }
    
    scores = {
        'time': get_time_factor(hour),
        'day': DAY_FACTORS[day_of_week],
        'weather': weather_factor(
            weather['code'], weather['precip'], weather['temp']
        ),
        'events': events_factor(events),
        'historical': 0.6,  # Valeur par défaut sans historique
    }
    
    composite = sum(WEIGHTS[k] * scores[k] for k in WEIGHTS)
    return round(composite * 10, 2)  # Normaliser sur 10
```

## Interprétation des scores

```
Score 8.0–10.0  🔴 Très forte demande — Rester dans la zone
Score 6.0–7.9   🟠 Forte demande — Zone prioritaire
Score 4.0–5.9   🟡 Demande modérée — Ok si pas mieux
Score 2.0–3.9   🟢 Faible demande — Envisager de bouger
Score 0.0–1.9   ⚪ Très faible — Changer de zone
```

## Recalcul automatique (Supabase Trigger)

```sql
-- Recalculer les scores toutes les 15 minutes via pg_cron
SELECT cron.schedule(
  'recalculate-scores',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://xxx.supabase.co/functions/v1/score-calculator',
      headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb,
      body := '{"all_zones": true}'::jsonb
    )
  $$
);
```

## Prévision sur 4h (planning shift)

```python
def forecast_shift(start_hour: int, zones: list, weather_forecast: dict) -> list:
    """Prédire les 4 prochaines heures par zone."""
    predictions = []
    for hour_offset in range(16):  # 16 x 15min = 4h
        hour = (start_hour + hour_offset // 4) % 24
        minute = (hour_offset % 4) * 15
        for zone in zones:
            score = calculate_zone_score(
                zone['lat'], zone['lon'],
                hour, datetime.now().weekday(),
                weather_forecast.get(hour, {}),
                []  # Événements pré-filtrés
            )
            predictions.append({
                'zone': zone['name'],
                'time': f"{hour:02d}:{minute:02d}",
                'score': score
            })
    return sorted(predictions, key=lambda x: -x['score'])
```
