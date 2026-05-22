import { useQuery } from '@tanstack/react-query';

const WEATHER_TIMEZONE = 'America/Toronto';

const cityCoords: Record<string, { lat: number; lon: number }> = {
  mtl: { lat: 45.5017, lon: -73.5673 },
  qc: { lat: 46.8139, lon: -71.208 },
  ott: { lat: 45.4215, lon: -75.6972 },
  lvl: { lat: 45.5559, lon: -73.7217 },
  laval: { lat: 45.5559, lon: -73.7217 },
  lng: { lat: 45.5249, lon: -73.5219 },
  longueuil: { lat: 45.5249, lon: -73.5219 },
};

function formatHourlyKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<'year' | 'month' | 'day' | 'hour', string>;

  return `${values.year}-${values.month}-${values.day}T${values.hour}:00`;
}

export interface WeatherData {
  temp: number;
  description: string;
  icon: string;
  isBadWeather: boolean;
  weatherId: number;
  /** 0-100 precipitation probability for current hour */
  precipProbability: number;
  /** mm of precipitation */
  precipitation: number;
  /** Open-Meteo WMO weather code */
  weatherCode: number;
  /** Wind speed km/h */
  windSpeed: number;
  /** Computed weather boost points for demand scoring */
  demandBoostPoints: number;
}

/** Map WMO weather codes to icon + description */
function getWeatherMeta(code: number): {
  icon: string;
  description: string;
  isBadWeather: boolean;
} {
  // WMO Weather interpretation codes
  if (code === 0)
    return { icon: '☀️', description: 'Dégagé', isBadWeather: false };
  if (code <= 3)
    return {
      icon: '⛅',
      description: 'Partiellement nuageux',
      isBadWeather: false,
    };
  if (code <= 48)
    return { icon: '🌫️', description: 'Brouillard', isBadWeather: true };
  if (code <= 57)
    return { icon: '🌧️', description: 'Bruine', isBadWeather: true };
  if (code <= 67)
    return { icon: '🌧️', description: 'Pluie', isBadWeather: true };
  if (code <= 77)
    return { icon: '🌨️', description: 'Neige', isBadWeather: true };
  if (code <= 82)
    return { icon: '🌧️', description: 'Averses', isBadWeather: true };
  if (code <= 86)
    return { icon: '🌨️', description: 'Averses de neige', isBadWeather: true };
  if (code === 95)
    return { icon: '⛈️', description: 'Orage', isBadWeather: true };
  if (code <= 99)
    return { icon: '⛈️', description: 'Orage avec grêle', isBadWeather: true };
  return { icon: '🌥️', description: 'Nuageux', isBadWeather: false };
}

/**
 * Calculate demand boost points from weather conditions. Mirrors the
 * Edge-Function-side computeWeatherBoost so the UI badge and the actual
 * scoring agree. Mr Montreal-calibrated: snow is a 25-30 pt swing, freezing
 * rain even more, deep cold (-20) is another +15.
 */
function calcWeatherBoost(
  precipProb: number,
  weatherCode: number,
  precip: number,
  temp: number,
): number {
  let boost = 0;

  // Severe / dangerous
  if (weatherCode >= 95) boost += 25;                          // thunderstorm
  else if (weatherCode >= 85 && weatherCode <= 86) boost += 30; // wet snow showers
  else if (weatherCode >= 71 && weatherCode <= 77) boost += 25; // snow
  else if (weatherCode >= 80 && weatherCode <= 82) boost += 15; // rain showers
  else if (weatherCode >= 61 && weatherCode <= 67) boost += 12; // sustained rain
  else if (weatherCode >= 51 && weatherCode <= 57) boost += 6;  // drizzle
  else if (weatherCode >= 45 && weatherCode <= 48) boost += 4;  // fog

  // Precip intensity (current hour)
  if (precip > 10) boost += 8;
  else if (precip > 5) boost += 5;
  else if (precip > 1) boost += 2;

  // Lookahead via probability — if the next hour is very likely wet, pre-boost
  if (boost === 0) {
    if (precipProb > 80) boost += 8;
    else if (precipProb > 60) boost += 4;
  }

  // Temperature extremes
  if (temp < -20) boost += 15;
  else if (temp < -10) boost += 10;
  else if (temp < 0) boost += 5;
  else if (temp > 32) boost += 5;

  return Math.min(boost, 40);
}

export function useWeather(cityId: string) {
  return useQuery<WeatherData>({
    queryKey: ['weather', cityId],
    queryFn: async () => {
      const coords = cityCoords[cityId];
      if (!coords) throw new Error('Unknown city');

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=precipitation_probability,precipitation,weather_code,wind_speed_10m&current=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=${WEATHER_TIMEZONE}&forecast_days=2`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Open-Meteo fetch failed');
      const data = await res.json();

      const currentTemp = Math.round(data.current.temperature_2m);
      const currentCode = data.current.weather_code;
      const currentPrecip = data.current.precipitation;
      const currentWind = data.current.wind_speed_10m;

      // Get current hour's precipitation probability from hourly data
      const now = new Date();
      const hourlyTimes: string[] = data.hourly.time;
      const currentHourKey = formatHourlyKey(now, WEATHER_TIMEZONE);
      const hourIndex = hourlyTimes.findIndex(
        (time: string) => time === currentHourKey
      );
      let precipProb = 0;
      if (hourIndex >= 0) {
        precipProb = data.hourly.precipitation_probability[hourIndex] ?? 0;
      }

      const meta = getWeatherMeta(currentCode);
      const demandBoostPoints = calcWeatherBoost(
        precipProb,
        currentCode,
        currentPrecip,
        currentTemp,
      );

      // Map WMO code to approximate OpenWeatherMap id for backward compat
      let weatherId = 800; // clear
      if (currentCode >= 95)
        weatherId = 200; // thunderstorm
      else if (currentCode >= 71 && currentCode <= 77)
        weatherId = 600; // snow
      else if (currentCode >= 51 && currentCode <= 67)
        weatherId = 500; // rain
      else if (currentCode >= 45 && currentCode <= 48)
        weatherId = 741; // fog
      else if (currentCode >= 80 && currentCode <= 82)
        weatherId = 502; // heavy rain
      else if (currentCode >= 83 && currentCode <= 86) weatherId = 601; // snow showers

      return {
        temp: currentTemp,
        description: meta.description,
        icon: meta.icon,
        isBadWeather: meta.isBadWeather,
        weatherId,
        precipProbability: precipProb,
        precipitation: currentPrecip,
        weatherCode: currentCode,
        windSpeed: currentWind,
        demandBoostPoints,
      };
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000, // 30 min auto-refresh
  });
}
