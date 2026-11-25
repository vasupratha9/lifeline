'use strict';

/**
 * Live conditions from Open-Meteo (free, no API key, no personal data required).
 *   - Geocoding API     : place name -> coordinates + country
 *   - Forecast API      : 3-day temperature, rain and wind
 *   - Air-Quality API   : current US AQI and PM2.5
 * Every call has a timeout and is cached; any failure degrades gracefully to null.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const finiteValues = (arr) => (Array.isArray(arr) ? arr.filter(Number.isFinite) : []);
const maxOf = (arr) => {
  const values = finiteValues(arr);
  return values.length ? Math.max(...values) : null;
};
const sumOf = (arr) => {
  const values = finiteValues(arr);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);

function createWeatherClient({ cache, timeoutMs = 8000, fetchImpl = globalThis.fetch, logger = console } = {}) {
  async function getJson(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Upstream responded ${response.status}`);
    return response.json();
  }

  async function geocode(name) {
    const key = `geo:${name.toLowerCase()}`;
    return cache.wrap(key, async () => {
      const url = `${GEOCODE_URL}?${new URLSearchParams({ name, count: '1', language: 'en', format: 'json' })}`;
      const data = await getJson(url);
      const hit = data && Array.isArray(data.results) ? data.results[0] : null;
      if (!hit) return null;
      return {
        name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
        country: hit.country || '',
        countryCode: hit.country_code || '',
        lat: Math.round(hit.latitude * 100) / 100,
        lon: Math.round(hit.longitude * 100) / 100,
      };
    });
  }

  async function conditions(lat, lon) {
    const key = `wx:${lat},${lon}`;
    return cache.wrap(key, async () => {
      const forecastParams = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m',
        daily: 'temperature_2m_max,apparent_temperature_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
        forecast_days: '3',
        timezone: 'auto',
      });
      const airParams = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'us_aqi,pm2_5' });

      // Fetch forecast and air quality in parallel; either may fail independently.
      const [forecast, air] = await Promise.allSettled([
        getJson(`${FORECAST_URL}?${forecastParams}`),
        getJson(`${AIR_URL}?${airParams}`),
      ]);
      if (forecast.status !== 'fulfilled' && air.status !== 'fulfilled') return null;

      const f = forecast.status === 'fulfilled' ? forecast.value : {};
      const a = air.status === 'fulfilled' ? air.value : {};
      const daily = f.daily || {};
      const current = f.current || {};
      return {
        temperature: finiteOrNull(current.temperature_2m),
        apparentTemperature: finiteOrNull(current.apparent_temperature),
        maxTemp: maxOf(daily.temperature_2m_max),
        maxApparentTemp: maxOf(daily.apparent_temperature_max),
        precip3d: sumOf(daily.precipitation_sum),
        maxPrecipDay: maxOf(daily.precipitation_sum),
        maxWind: maxOf(daily.wind_speed_10m_max),
        maxGust: maxOf(daily.wind_gusts_10m_max),
        aqi: finiteOrNull(a.current && a.current.us_aqi),
        pm25: finiteOrNull(a.current && a.current.pm2_5),
      };
    });
  }

  /** Resolve a profile's location to a place, preferring device coordinates. */
  async function resolve(profile) {
    try {
      if (profile.coords) {
        return { name: profile.location || 'Your current location', country: '', countryCode: '', ...profile.coords };
      }
      if (profile.location) return await geocode(profile.location);
    } catch (err) {
      logger.warn(JSON.stringify({ severity: 'WARNING', message: 'geocode failed', error: err.message }));
    }
    return null;
  }

  async function safeConditions(place) {
    if (!place) return null;
    try {
      return await conditions(place.lat, place.lon);
    } catch (err) {
      logger.warn(JSON.stringify({ severity: 'WARNING', message: 'weather failed', error: err.message }));
      return null;
    }
  }

  return { geocode, conditions, resolve, safeConditions };
}

module.exports = { createWeatherClient };
