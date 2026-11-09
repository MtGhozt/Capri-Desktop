'use strict';

// Optional city weather (Open-Meteo) and public holidays (Nager.Date). No API keys.
// Failures stay silent: temporal context and direct answers simply omit the data.

const WEATHER_TTL_MS = 30 * 60 * 1000;
const HOLIDAY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4000;

const WMO = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'niebla', 48: 'niebla helada',
  51: 'llovizna leve', 53: 'llovizna', 55: 'llovizna fuerte',
  61: 'lluvia leve', 63: 'lluvia', 65: 'lluvia fuerte',
  71: 'nieve leve', 73: 'nieve', 75: 'nieve fuerte',
  80: 'chubascos leves', 81: 'chubascos', 82: 'chubascos fuertes',
  95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta con granizo fuerte',
};

function weatherLabel(code) {
  return WMO[Number(code)] || 'condiciones variables';
}

function willRain(code, precipProb) {
  const c = Number(code);
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(c)) return true;
  return Number(precipProb) >= 50;
}

// Sync detector for the multi-command splitter (same idea as parseReminderCommand).
function isWeatherOrHolidayQuestion(text) {
  const { normalizeCommandText } = require('./command-text');
  const said = normalizeCommandText(text);
  if (!said) return false;
  return /\b(llueve|llover|lluvia|clima|tiempo|temperatura|hace\s+frio|hace\s+calor|va\s+a\s+llover|pronostico)\b/.test(said)
    || /\b(feriado|feriados|holiday|festivo|festivos|dia\s+festivo)\b/.test(said);
}

function createWeather({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let geo = null; // { key, at, value }
  let forecast = null; // { key, at, value }
  const holidayCache = new Map(); // key → { at, value } (year and year+1 both stick)

  async function getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Capri-Desktop' },
        signal: controller.signal,
      });
      if (!res?.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function geocode(place) {
    const key = String(place || '').trim().toLowerCase();
    if (!key) return null;
    if (geo && geo.key === key && now() - geo.at < WEATHER_TTL_MS) return geo.value;
    const q = encodeURIComponent(String(place).trim());
    const json = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=es&format=json`,
    );
    const hit = json?.results?.[0];
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) {
      geo = { key, at: now(), value: null };
      return null;
    }
    const value = {
      name: String(hit.name || place).trim(),
      country: String(hit.country || '').trim(),
      countryCode: String(hit.country_code || '').trim().toUpperCase(),
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: String(hit.timezone || '').trim(),
    };
    geo = { key, at: now(), value };
    return value;
  }

  async function loadForecast(place, timeZone) {
    const loc = await geocode(place);
    if (!loc) return null;
    const zone = String(timeZone || loc.timezone || 'auto');
    const key = `${loc.latitude},${loc.longitude},${zone}`;
    if (forecast && forecast.key === key && now() - forecast.at < WEATHER_TTL_MS) {
      return { loc, weather: forecast.value };
    }
    const params = new URLSearchParams({
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      timezone: zone || 'auto',
      current: 'temperature_2m,weather_code,precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: '2',
    });
    const json = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!json?.current || !json?.daily) {
      forecast = { key, at: now(), value: null };
      return null;
    }
    const value = {
      currentTemp: json.current.temperature_2m,
      currentCode: json.current.weather_code,
      currentPrecip: json.current.precipitation_probability,
      days: (json.daily.time || []).map((date, i) => ({
        date,
        code: json.daily.weather_code?.[i],
        tmax: json.daily.temperature_2m_max?.[i],
        tmin: json.daily.temperature_2m_min?.[i],
        precip: json.daily.precipitation_probability_max?.[i],
      })),
    };
    forecast = { key, at: now(), value };
    return { loc, weather: value };
  }

  async function loadHolidays(countryCode, year) {
    const code = String(countryCode || '').trim().toUpperCase();
    const y = Number(year);
    if (!code || !Number.isFinite(y)) return null;
    const key = `${code}:${y}`;
    const hit = holidayCache.get(key);
    if (hit && now() - hit.at < HOLIDAY_TTL_MS) return hit.value;
    const json = await getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/${code}`);
    if (!Array.isArray(json)) {
      holidayCache.set(key, { at: now(), value: null });
      return null;
    }
    const value = json.map((item) => ({
      date: String(item.date || ''),
      name: String(item.localName || item.name || '').trim(),
    })).filter((item) => item.date && item.name);
    holidayCache.set(key, { at: now(), value });
    return value;
  }

  function formatWeatherLine(loc, weather) {
    if (!loc || !weather) return '';
    const where = [loc.name, loc.country].filter(Boolean).join(', ');
    const today = weather.days[0];
    const bits = [
      `Clima en ${where}: ${Math.round(weather.currentTemp)}°C, ${weatherLabel(weather.currentCode)}`,
    ];
    if (today && Number.isFinite(today.precip)) {
      bits.push(`hoy chance de lluvia ${Math.round(today.precip)}%`);
    }
    if (today && Number.isFinite(today.tmax) && Number.isFinite(today.tmin)) {
      bits.push(`máx ${Math.round(today.tmax)}°C / mín ${Math.round(today.tmin)}°C`);
    }
    return `${bits.join('; ')}.`;
  }

  function formatHolidayLine(list, { fromDate, limit = 3 } = {}) {
    if (!Array.isArray(list) || !list.length) return '';
    const start = String(fromDate || '').slice(0, 10);
    const upcoming = list.filter((item) => !start || item.date >= start).slice(0, limit);
    if (!upcoming.length) return '';
    return `Feriados próximos: ${upcoming.map((item) => `${item.date} ${item.name}`).join('; ')}.`;
  }

  async function contextSnippet({ place, timeZone, at = new Date(now()) } = {}) {
    const city = String(place || '').trim();
    if (!city) return '';
    const packed = await loadForecast(city, timeZone);
    if (!packed?.weather) return '';
    const parts = [formatWeatherLine(packed.loc, packed.weather)];
    // local calendar day for "from"
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || packed.loc.timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
    const year = Number(localDay.slice(0, 4));
    const days = await loadHolidays(packed.loc.countryCode, year);
    const nextYear = await loadHolidays(packed.loc.countryCode, year + 1);
    const merged = [...(days || []), ...(nextYear || [])];
    const holiday = formatHolidayLine(merged, { fromDate: localDay });
    if (holiday) parts.push(holiday);
    parts.push('Usá solo estos datos de clima/feriados; si no están, no inventes.');
    return parts.filter(Boolean).join(' ');
  }

  async function answerDirect(text, { place, timeZone, at = new Date(now()) } = {}) {
    const { normalizeCommandText } = require('./command-text');
    const said = normalizeCommandText(text);
    if (!said || !isWeatherOrHolidayQuestion(said)) return null;
    const city = String(place || '').trim();
    if (!city) {
      return 'Configurá una ciudad en Ajustes › Comportamiento (junto a la zona horaria) y te digo.';
    }
    const isHolidayQuestion = /\b(feriado|feriados|holiday|festivo|festivos|dia\s+festivo)\b/.test(said);

    const packed = await loadForecast(city, timeZone);
    if (!packed?.weather) {
      return 'Ahora no puedo consultar el clima; intentá de nuevo cuando haya red.';
    }
    const { loc, weather } = packed;
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || loc.timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
    const tomorrow = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || loc.timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(at.getTime() + 86400000));

    if (isHolidayQuestion) {
      const year = Number(localDay.slice(0, 4));
      const days = await loadHolidays(loc.countryCode, year);
      const nextYear = await loadHolidays(loc.countryCode, year + 1);
      const merged = [...(days || []), ...(nextYear || [])];
      if (!merged.length) {
        return 'No pude consultar los feriados ahora.';
      }
      const askTomorrow = /\bmanana\b/.test(said);
      const day = askTomorrow ? tomorrow : localDay;
      const hit = merged.find((item) => item.date === day);
      if (/\b(hoy|manana)\b/.test(said) || askTomorrow) {
        return hit
          ? `${askTomorrow ? 'Mañana' : 'Hoy'} es feriado: ${hit.name}.`
          : `${askTomorrow ? 'Mañana' : 'Hoy'} no es feriado.`;
      }
      const line = formatHolidayLine(merged, { fromDate: localDay, limit: 5 });
      return line || 'No hay feriados próximos en la lista.';
    }

    const askTomorrow = /\bmanana\b/.test(said);
    const day = weather.days.find((d) => d.date === (askTomorrow ? tomorrow : localDay)) || weather.days[askTomorrow ? 1 : 0];
    if (!day) return formatWeatherLine(loc, weather);

    if (/\b(llueve|llover|lluvia|va\s+a\s+llover)\b/.test(said)) {
      const rain = willRain(day.code, day.precip);
      const when = askTomorrow ? 'Mañana' : 'Hoy';
      const prob = Number.isFinite(day.precip) ? ` (chance ${Math.round(day.precip)}%)` : '';
      return rain
        ? `${when} sí apunta a lluvia en ${loc.name}${prob}.`
        : `${when} no parece que llueva en ${loc.name}${prob}.`;
    }

    return formatWeatherLine(loc, weather);
  }

  function clearCache() {
    geo = forecast = null;
    holidayCache.clear();
  }

  return {
    contextSnippet,
    answerDirect,
    formatWeatherLine,
    formatHolidayLine,
    weatherLabel,
    willRain,
    clearCache,
    WEATHER_TTL_MS,
    HOLIDAY_TTL_MS,
  };
}

module.exports = {
  createWeather, weatherLabel, willRain, isWeatherOrHolidayQuestion,
  WEATHER_TTL_MS, HOLIDAY_TTL_MS,
};
