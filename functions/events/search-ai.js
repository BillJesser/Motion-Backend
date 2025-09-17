import { load as loadHtml } from 'cheerio';
import Ajv from 'ajv';
import Together from 'together-ai';
import { canonicalizeTags, selectTags, ALLOWED_TAGS } from '../lib/classify.js';

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY || '' });

// --- Config ---
const MODEL = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
const TAVILY_URL = 'https://api.tavily.com/search';
const USER_AGENT = 'Mozilla/5.0 (EventsAgent; +https://example.com)';

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
    required: ['title', 'start_date', 'timezone', 'location', 'source_url'],
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
        required: ['city', 'state', 'country'],
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

// --- Tavily search ---
async function searchWeb({ city, region_or_state, country, start_date, end_date }) {
  const q = `events ${city} ${region_or_state} ${country} between ${start_date} and ${end_date} site:(eventbrite.com OR ticketmaster.com OR bandsintown.com OR meetup.com OR official venue site)`;
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY || '',
      query: q,
      include_answer: false,
      max_results: 12
    })
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = await res.json();
  return (data?.results || []).map(r => ({ title: r.title, snippet: r.content, url: r.url }));
}

// --- Fetch & skim each page for better context (meta tags etc.) ---
async function enrichFromPage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = loadHtml(html);
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDesc = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const eventName = $('[itemprop="name"]').first().text().trim() || ogTitle;
    const desc = $('[itemprop="description"]').first().text().trim() || ogDesc;
    return {
      page_title: $('title').text().trim() || ogTitle,
      event_name: eventName,
      description: desc,
      image: ogImage
    };
  } catch {
    return {};
  }
}

// --- Build the model messages ---
function buildMessages(systemPrompt, userTemplate, userVars, harvested) {
  const harvestedBlock = harvested
    .map((h, i) => {
      const lines = [
        `#${i + 1}`,
        `URL: ${h.url}`,
        `TITLE: ${h.title || ''}`,
        `SNIPPET: ${h.snippet || ''}`,
        `PAGE_TITLE: ${h.meta?.page_title || ''}`,
        `PAGE_EVENT_NAME: ${h.meta?.event_name || ''}`,
        `PAGE_DESC: ${h.meta?.description || ''}`,
        `PAGE_IMAGE: ${h.meta?.image || ''}`
      ];
      return lines.join('\n');
    })
    .join('\n\n');

  const userFilled = `
${userTemplate}

Resolved Variables:
- city: ${userVars.city}
- region_or_state: ${userVars.region_or_state}
- country: ${userVars.country}
- zipcode: ${userVars.zipcode || ''}
- start_date: ${userVars.start_date}
- end_date: ${userVars.end_date}
- timezone: ${userVars.timezone}

HARVESTED SOURCES (search + page skim):
${harvestedBlock}
`.trim();

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userFilled }
  ];
}

// --- Call Together.ai and force JSON ---
async function modelToEvents(messages) {
  const completion = await together.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages
  });
  const text = completion.choices?.[0]?.message?.content || '[]';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\[.*\]/s);
    parsed = m ? JSON.parse(m[0]) : [];
  }
  const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [];
  return events;
}

// --- Public orchestrator ---
export async function findEvents({ city, region_or_state, country, zipcode, start_date, end_date, timezone }) {
  const results = await searchWeb({ city, region_or_state, country, start_date, end_date });

  const enriched = await Promise.all(
    results.map(async r => ({ ...r, meta: await enrichFromPage(r.url) }))
  );

  const SYSTEM_PROMPT = `
You are an assistant that finds real-world local public events (concerts, festivals, shows, markets, etc.) for a given place and time window.
Return STRICT JSON ONLY (no prose) as an array of events. Follow the output schema exactly. If nothing is found, return [].

Rules:
- Use the requested timezone for dates/times.
- Normalize: dates = YYYY-MM-DD, times = HH:MM (24h).
- Prefer official or reputable sources (venues, organizers, ticketing sites).
- De-duplicate by (title + start_date + venue).
- If any field is unknown, omit the field rather than guessing.
- Include a reliable source_url for each event whenever possible.

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

  const USER_TEMPLATE = `
USER
Find events.

Location:
- city: {{city}}
- region_or_state: {{region_or_state}}
- country: {{country}}
- zipcode: {{zipcode}}

Time window:
- start_date: {{start_date}}
- end_date:   {{end_date}}

Timezone for dates/times: {{timezone}}

Use ONLY the harvested sources provided below (and your general knowledge) to produce events within the window and location. If you cannot confirm details, omit those fields. Return ONLY JSON.
`.trim();

  const messages = buildMessages(
    SYSTEM_PROMPT,
    USER_TEMPLATE,
    { city, region_or_state, country, zipcode, start_date, end_date, timezone },
    enriched
  );

  const rawEvents = await modelToEvents(messages);

  const normalized = rawEvents.map(e => ({
    ...e,
    timezone: e.timezone || timezone,
    location: {
      ...e.location,
      city,
      state: region_or_state,
      country
    }
  }));

  const deduped = dedupeEvents(normalized);

  // Validate and salvage obvious rows if needed
  const valid = validateEvents(deduped);
  let finalEvents = deduped;
  if (!valid) {
    console.error('Validation errors:', validateEvents.errors);
    finalEvents = deduped.filter(ev =>
      ev?.title &&
      ev?.start_date?.match(/^\d{4}-\d{2}-\d{2}$/) &&
      ev?.timezone &&
      ev?.location?.city && ev?.location?.state && ev?.location?.country &&
      ev?.source_url
    );
  }

  // Normalize tags: map to allowed list; if none, auto-classify
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
    const city = (qs.city || '').trim();
    const region_or_state = (qs.state || qs.region_or_state || '').trim();
    const country = (qs.country || '').trim();
    const zipcode = (qs.zipcode || qs.zip || '').trim();
    const start_date = (qs.start_date || '').trim();
    const end_date = (qs.end_date || '').trim();
    const timezone = (qs.timezone || '').trim();

    if (!city || !region_or_state || !country || !start_date || !end_date || !timezone) {
      return response(400, { message: 'city, state (region_or_state), country, start_date, end_date, timezone are required' });
    }

    if (!process.env.TOGETHER_API_KEY) {
      return response(500, { message: 'Together API key not configured' });
    }
    if (!process.env.TAVILY_API_KEY) {
      return response(500, { message: 'Tavily API key not configured' });
    }

    const items = await findEvents({ city, region_or_state, country, zipcode, start_date, end_date, timezone });
    return response(200, { count: items.length, items });
  } catch (err) {
    console.error('Search AI events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
