import Ajv from 'ajv';
import { LocationClient, SearchPlaceIndexForPositionCommand } from '@aws-sdk/client-location';
import { canonicalizeTags, selectTags, ALLOWED_TAGS } from '../lib/classify.js';

// --- Config ---
const GEMINI_MODEL = 'gemini-2.5-pro';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 45000;

const PLACE_INDEX_NAME = process.env.PLACE_INDEX_NAME || '';
const locationClient = new LocationClient({});

const BLOCKED_AGGREGATOR_DOMAINS = ['eventbrite.com','ticketmaster.com','livenation.com','bandsintown.com','meetup.com','facebook.com','instagram.com','allevents.in','eventful.com','stubhub.com','tickpick.com','vividseats.com','songkick.com'];

function isBlockedDomain(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return BLOCKED_AGGREGATOR_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

// --- Ajv schema (array of events) ---
const ajv = new Ajv({ allErrors: true, strict: false });
const eventSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['title', 'start_date', 'source_url'],
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      end_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      start_time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
      end_time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
      timezone: { type: 'string' },
      location: {
        type: 'object',
        additionalProperties: false,
        properties: {
          venue: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' }
        }
      },
      organizer: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          contact_email: { type: 'string' },
          phone: { type: 'string' }
        }
      },
      ticket_info: {
        type: 'object',
        additionalProperties: false,
        properties: {
          price: { type: 'string' },
          currency: { type: 'string' },
          purchase_url: { type: 'string' }
        }
      },
      media: {
        type: 'object',
        additionalProperties: false,
        properties: {
          image_url: { type: 'string' },
          video_url: { type: 'string' }
        }
      },
      tags: { type: 'array', items: { type: 'string' } },
      source_url: { type: 'string' }
    }
  }
};
const validateEvents = ajv.compile(eventSchema);

// --- Utility: dedupe by (title + start_date + venue) ---
function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(ev => {
    const venue = ev?.location?.venue || '';
    const key = `${(ev.title || '').trim()}|${ev.start_date || ''}|${venue.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function reverseGeocode({ lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !PLACE_INDEX_NAME) return null;
  try {
    const command = new SearchPlaceIndexForPositionCommand({
      IndexName: PLACE_INDEX_NAME,
      Position: [Number(lng), Number(lat)]
    });
    const result = await locationClient.send(command);
    const place = result?.Results?.[0]?.Place || {};
    const city = (place.Municipality || place.SubRegion || place.Locality || place.Neighborhood || '').trim();
    const region_or_state = (place.Region || place.SubRegion || '').trim();
    const country = (place.Country || '').trim();
    const postalCode = (place.PostalCode || '').trim();
    if (!city || !region_or_state || !country) return null;
    return { city, region_or_state, country, postalCode };
  } catch (err) {
    console.error('Reverse geocode failed', err);
    return null;
  }
}

function parseCoordinate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

// --- Gemini helper utilities ---
function buildGeminiUserPrompt({ city, region_or_state, country, start_date, end_date, timezone, radius_miles, preferLocal }) {
  const radiusNote = Number.isFinite(radius_miles) && radius_miles > 0
    ? `${radius_miles} mile radius`
    : 'the immediate local area';
  const localityPreference = preferLocal
    ? 'Strongly prioritize official local/community sources (city or county sites, CVBs, tourism bureaus, downtown alliances, libraries, parks & recreation, local news). Use Google Search grounding to surface these first.'
    : 'Use any trustworthy sources you can confirm, leaning toward local/community references when available.';

  return [
    'Find real-world public events for the requested place and window.',
    'When possible, gather around 10 solid options.',
    '',
    'Location:',
    `- city: ${city}`,
    `- region_or_state: ${region_or_state}`,
    `- country: ${country}`,
    '',
    'Time window:',
    `- start_date: ${start_date}`,
    `- end_date: ${end_date}`,
    '',
    `Target radius: ${radiusNote}`,
    localityPreference,
    'Include events even if some logistical details are missing, as long as the source link is trustworthy.',
    '',
    'Instructions:',
    '- Only include events occurring within the requested dates (inclusive) and inside the radius.',
    '- Use Google Search tool results to open an event page and verify the date/time/location before adding it.',
    '- Every event must cite the exact page you inspected as source_url.',
    '- The source_url must be a direct, working event-detail link on the official/local host (not homepages, search results, redirect URLs, or ticketing aggregators). Skip the event if you cannot find that exact page.',
    '- Favor community calendars, civic/tourism sites, local news, and avoid large ticketing aggregators.',
    '- Aim for roughly 10 qualifying events when the sources exist.',
    '- Format dates as YYYY-MM-DD and times as HH:MM (24h).',
    '',
    `Timezone for normalization: ${timezone}`
  ].join('\n');
}

function decodeGeminiInlineData(part) {
  if (!part?.inlineData?.data) return '';
  try {
    return Buffer.from(part.inlineData.data, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractTextFromCandidates(data) {
  if (!data?.candidates) return '';
  for (const candidate of data.candidates) {
    const parts = candidate?.content?.parts || [];
    const textParts = parts
      .map(p => typeof p.text === 'string' ? p.text : decodeGeminiInlineData(p))
      .filter(Boolean);
    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }
  }
  return '';
}

function tryParseEventsFromText(text) {
  if (!text) return [];
  const trimmed = text.trim();
  const attempts = [trimmed];
  const arraySlice = (() => {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return null;
  })();
  const objectSlice = (() => {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return null;
  })();
  if (arraySlice) attempts.push(arraySlice);
  if (objectSlice) attempts.push(objectSlice);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.events)) return parsed.events;
    } catch {
      // continue
    }
  }
  return [];
}

async function callGeminiForEvents({ systemPrompt, userPrompt, debug }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${apiKey}`;
    const body = {
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      tools: [
        { google_search: {} }
      ],
      generationConfig: {
        temperature: 0.2,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 30000
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const payload = await res.json();
    let text = '';
    const primaryText = payload?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
    if (primaryText) {
      text = primaryText;
    } else {
      text = extractTextFromCandidates(payload);
    }
    if (debug) {
      console.log('Gemini response snippet:', text?.slice(0, 500) || '');
    }
    return tryParseEventsFromText(text);
  } finally {
    clearTimeout(timer);
  }
}

// --- Public orchestrator ---
export async function findEvents({ city, region_or_state, country, start_date, end_date, timezone, radius_miles = 5, debug = false, preferLocal = true }) {
  const parsedRadius = Number(radius_miles);
  const normalizedRadius = Number.isFinite(parsedRadius) ? Math.min(100, Math.max(0, parsedRadius)) : 5;

  const SYSTEM_PROMPT = `
You are an assistant that researches real-world LOCAL public events (concerts, festivals, shows, markets, etc.) for a specified place and time window.
Use the Google Search grounding tool before answering so that every event is backed by a trustworthy local source.
Return STRICT JSON ONLY (no prose) as an array of events. If nothing is found, return [].

Rules:
- Use the requested timezone for dates/times.
- Normalize: dates = YYYY-MM-DD, times = HH:MM (24h).
- Strongly prefer LOCAL community sources: city/county (.gov/.us/.net), libraries, parks & recreation, community/downtown/chamber, museums/arts, tourism/visitors/CVB, and local news sites.
- Deprioritize large aggregators (Eventbrite, Ticketmaster, Meetup, Bandsintown, Facebook, Instagram) unless no local source exists.
- Actively click through Google Search results to confirm the event page exists and visibly lists its date/time/venue before including it.
- Each event must include a verifiable source_url from that same inspected page.
- The source_url must be a live, fully-qualified event-detail URL on the official/local domain (never search results, generic homepages, redirect wrappers, or ticketing aggregators). If you cannot open or verify the page, omit the event.
- Aim to return 10 distinct events when available; include credible events even if some details are missing.
- De-duplicate by (title + start_date + venue).
- If any field is unknown, omit the field rather than guessing.

OUTPUT SCHEMA (use exactly these keys when present):
[
  {
    "title": "string",
    "description": "string",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "timezone": "string",
    "location": {
      "venue": "string",
      "address": "string",
      "city": "string",
      "state": "string",
      "country": "string",
      "latitude": number,
      "longitude": number
    },
    "organizer": {
      "name": "string",
      "contact_email": "string",
      "phone": "string"
    },
    "ticket_info": {
      "price": "string",
      "currency": "string",
      "purchase_url": "string"
    },
    "media": {
      "image_url": "string",
      "video_url": "string"
    },
    "tags": ["string", "..."],
    "source_url": "string"
  }
]
`.trim();

  const userPrompt = buildGeminiUserPrompt({
    city,
    region_or_state,
    country,
    start_date,
    end_date,
    timezone,
    radius_miles: normalizedRadius,
    preferLocal
  });

  const rawEvents = await callGeminiForEvents({ systemPrompt: SYSTEM_PROMPT, userPrompt, debug });
  if (debug) {
    console.log('Gemini raw events (count):', Array.isArray(rawEvents) ? rawEvents.length : 'not-array');
    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      const sample = rawEvents.slice(0, 3).map((e, i) => ({
        i,
        title: e.title,
        start_date: e.start_date,
        end_date: e.end_date,
        start_time: e.start_time,
        end_time: e.end_time,
        source_url: e.source_url
      }));
      console.log('Gemini raw sample (first 3):', JSON.stringify(sample));
    }
  }

  function toHHMM(s) {
    if (!s || typeof s !== 'string') return null;
    const t = s.trim().toLowerCase().replace(/\s+/g, '');
    let m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/);
    if (m) {
      let h = parseInt(m[1], 10);
      let min = m[2] ? parseInt(m[2], 10) : 0;
      const ampm = m[3];
      if (ampm === 'pm' && h !== 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      return null;
    }
    m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) {
      const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
      if (h>=0&&h<=23&&min>=0&&min<=59) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      return null;
    }
    m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
      if (h>=0&&h<=23&&min>=0&&min<=59) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      return null;
    }
    m = t.match(/^(\d{3,4})$/);
    if (m) {
      const raw = m[1].padStart(4,'0');
      const h = parseInt(raw.slice(0, -2), 10);
      const min = parseInt(raw.slice(-2), 10);
      if (h>=0&&h<=23&&min>=0&&min<=59) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
      return null;
    }
    return null;
  }

  function extractDateAndTime(value) {
    if (!value || typeof value !== 'string') return null;
    const t = value.trim();
    let m = t.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (m) {
      const hhmm = toHHMM(m[2]);
      return { date: m[1], time: hhmm || undefined };
    }
    m = t.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) {
      const timeToken = t.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i);
      const hhmm = timeToken ? toHHMM(timeToken[0]) : undefined;
      return { date: m[1], time: hhmm };
    }
    return null;
  }

  function isValidDateYYYYMMDD(val) {
    return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
  }

  const rawList = Array.isArray(rawEvents) ? rawEvents : [];
  const normalized = rawList.map(e => {
    const startDT = extractDateAndTime(e.start_date);
    if (startDT?.date) e.start_date = startDT.date;
    const nt = toHHMM(e.start_time) || startDT?.time || null;
    const endDT = extractDateAndTime(e.end_date);
    if (endDT?.date) e.end_date = endDT.date; else if (e.end_date !== undefined) e.end_date = undefined;
    const et = toHHMM(e.end_time) || endDT?.time || null;
    const base = {
      ...e,
      timezone: e.timezone || timezone,
      location: {
        ...e.location,
        city,
        state: region_or_state,
        country
      }
    };
    if (nt) base.start_time = nt; else delete base.start_time;
    if (et) base.end_time = et; else delete base.end_time;
    if (!isValidDateYYYYMMDD(base.end_date)) delete base.end_date;
    if (debug) {
      console.log('Normalized event times:', {
        title: base.title,
        start_date: base.start_date,
        start_time: base.start_time,
        end_date: base.end_date,
        end_time: base.end_time
      });
    }
    return base;
  });

  const deduped = dedupeEvents(normalized);

  const valid = validateEvents(deduped);
  let finalEvents = deduped;
  if (!valid) {
    console.error('Validation errors:', validateEvents.errors);
    if (debug) {
      const idxs = Array.from(new Set((validateEvents.errors || [])
        .map(e => {
          const m = String(e.instancePath || '').match(/^\/(\d+)/);
          return m ? Number(m[1]) : null;
        })
        .filter(v => v !== null)));
      for (const i of idxs) {
        const ev = deduped[i];
        console.log('Invalid event context', {
          i,
          title: ev?.title,
          start_date: ev?.start_date,
          start_time: ev?.start_time,
          end_date: ev?.end_date,
          end_time: ev?.end_time,
          source_url: ev?.source_url
        });
      }
    }
    finalEvents = deduped.filter(ev =>
      ev?.title &&
      ev?.source_url &&
      ev?.start_date?.match(/^\d{4}-\d{2}-\d{2}$/)
    );
  }

  finalEvents = finalEvents.filter(ev => !isBlockedDomain(ev?.source_url));

  finalEvents = finalEvents.map(ev => {
    const provided = canonicalizeTags(ev.tags);
    const withinAllowed = provided.filter(t => ALLOWED_TAGS.includes(t));
    const derived = withinAllowed.length > 0 ? withinAllowed : selectTags({ title: ev.title, location: ev.location });
    return { ...ev, tags: derived };
  });

  return finalEvents;
}

export const handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    let city = (qs.city || '').trim();
    let region_or_state = (qs.state || qs.region_or_state || '').trim();
    let country = (qs.country || '').trim();
    const start_date = (qs.start_date || '').trim();
    const end_date = (qs.end_date || '').trim();
    const timezone = (qs.timezone || '').trim();

    const lat = parseCoordinate(qs.lat ?? qs.latitude ?? qs.lat_deg ?? qs.latDeg);
    const lng = parseCoordinate(qs.lng ?? qs.lon ?? qs.longitude ?? qs.long ?? qs.lng_deg ?? qs.lngDeg);
    if ((lat !== undefined && lng === undefined) || (lat === undefined && lng !== undefined)) {
      return response(400, { message: 'Provide both lat and lng or neither' });
    }
    if (lat !== undefined && lng !== undefined) {
      if (!PLACE_INDEX_NAME) {
        return response(500, { message: 'Place index not configured for reverse geocoding' });
      }
      const resolved = await reverseGeocode({ lat, lng });
      if (resolved) {
        if (!city) city = resolved.city;
        if (!region_or_state) region_or_state = resolved.region_or_state;
        if (!country) country = resolved.country;
      } else {
        console.warn('Reverse geocode returned no result for coordinates', { lat, lng });
      }
    }

    const radiusCandidates = [qs.radius_miles, qs.radiusMiles, qs.radius, qs.radius_km];
    let radius_miles = undefined;
    for (let i = 0; i < radiusCandidates.length; i++) {
      const raw = radiusCandidates[i];
      if (raw === undefined || raw === null) continue;
      const value = Number(String(raw).trim());
      if (Number.isFinite(value) && value >= 0) {
        if (i === 3) {
          radius_miles = value * 0.621371;
        } else {
          radius_miles = value;
        }
        break;
      }
    }
    if (!Number.isFinite(radius_miles)) {
      radius_miles = 5;
    }

    if (!city || !region_or_state || !country || !start_date || !end_date || !timezone) {
      return response(400, { message: 'city, state (region_or_state), country, start_date, end_date, timezone are required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return response(500, { message: 'Gemini API key not configured' });
    }

    const debug = ['1','true','yes','on'].includes(String(qs.debug || '').toLowerCase());
    const preferLocal = !['0','false','no','off'].includes(String(qs.preferLocal || '1').toLowerCase());
    const items = await findEvents({ city, region_or_state, country, start_date, end_date, timezone, radius_miles, debug, preferLocal });
    return response(200, { count: items.length, items });
  } catch (err) {
    console.error('Search AI events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
