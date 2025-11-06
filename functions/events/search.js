import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LocationClient, SearchPlaceIndexForTextCommand } from '@aws-sdk/client-location';
import { encodeGeohash, expandNeighbors } from '../lib/geohash.js';
import { canonicalizeTags } from '../lib/classify.js';
import { haversineMeters } from '../lib/geo.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const location = new LocationClient({});
const TABLE = process.env.EVENTS_TABLE;
const PLACE_INDEX_NAME = process.env.PLACE_INDEX_NAME;

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

function buildIsoFromDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const date = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let time = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!time) time = '00:00';
  if (/^\d{2}:\d{2}$/.test(time)) {
    time = `${time}:00`;
  } else if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    // already includes seconds, keep as is
  } else if (/^\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(time)) {
    // includes timezone; keep as is
  } else {
    return null;
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(time)) {
    time = `${time}Z`;
  }
  return `${date}T${time}`;
}

function resolveTimeWindow(qs) {
  let startEpoch;
  let endEpoch;
  let isoEndProvided = false;

  if (qs.startTime) {
    const parsed = Date.parse(qs.startTime);
    if (Number.isNaN(parsed)) {
      return { error: 'startTime must be ISO 8601' };
    }
    startEpoch = Math.floor(parsed / 1000);
  }

  if (qs.endTime) {
    const parsedEnd = Date.parse(qs.endTime);
    if (!Number.isNaN(parsedEnd)) {
      endEpoch = Math.floor(parsedEnd / 1000);
      isoEndProvided = true;
    }
  }

  if (typeof startEpoch === 'number' || isoEndProvided) {
    if (typeof startEpoch === 'number' && isoEndProvided && endEpoch < startEpoch) {
      return { error: 'endTime must be after startTime' };
    }
    return { startEpoch, endEpoch };
  }

  const date = qs.date;
  if (!date) {
    return { startEpoch: undefined, endEpoch: undefined };
  }

  const startIso = buildIsoFromDateTime(date, qs.time);
  if (!startIso) {
    return { error: 'date must be YYYY-MM-DD and time must be HH:mm (optional)' };
  }
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    return { error: 'date or time could not be parsed' };
  }
  startEpoch = Math.floor(startMs / 1000);

  let endMs;
  const hasExplicitTime = Boolean(qs.time);
  if (qs.endDate || (qs.endTime && !isoEndProvided)) {
    const endIso = buildIsoFromDateTime(qs.endDate || date, qs.endTime && !isoEndProvided ? qs.endTime : (hasExplicitTime ? qs.time : '23:59:59'));
    if (!endIso) {
      return { error: 'endDate or endTime could not be parsed' };
    }
    endMs = Date.parse(endIso);
    if (Number.isNaN(endMs)) {
      return { error: 'endDate or endTime could not be parsed' };
    }
  } else {
    const windowMinutes = Number(qs.windowMinutes);
    const fallbackMinutes = hasExplicitTime ? 180 : 1440;
    const minutes = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : fallbackMinutes;
    endMs = startMs + minutes * 60 * 1000;
  }

  if (endMs < startMs) {
    return { error: 'The end of the range must be after the start of the range' };
  }

  endEpoch = Math.floor(endMs / 1000);
  return { startEpoch, endEpoch };
}

async function resolveCenter(query) {
  if (query.lat && query.lng) return { lat: Number(query.lat), lng: Number(query.lng) };
  const parts = [];
  if (query.address) parts.push(query.address);
  if (query.city) parts.push(query.city);
  if (query.state) parts.push(query.state);
  if (query.zip) parts.push(query.zip);
  if (query.country) parts.push(query.country);
  const text = parts.map(String).map(s => s.trim()).filter(Boolean).join(', ');
  if (!text) return null;
  const out = await location.send(new SearchPlaceIndexForTextCommand({ IndexName: PLACE_INDEX_NAME, Text: text, MaxResults: 1 }));
  const place = out.Results?.[0]?.Place;
  const [lng, lat] = place?.Geometry?.Point || [];
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
}

export const handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const center = await resolveCenter({
      lat: qs.lat,
      lng: qs.lng,
      address: qs.address,
      zip: qs.zip,
      city: qs.city,
      state: qs.state,
      country: qs.country
    });
    if (!center) return response(400, { message: 'Provide lat/lng or address/city-state/zip' });

    const radiusMiles = Math.max(0.1, Number(qs.radiusMiles || 10));
    const radiusMeters = radiusMiles * 1609.34;
    const { startEpoch, endEpoch, error } = resolveTimeWindow(qs);
    if (error) return response(400, { message: error });

    const gh = encodeGeohash(center.lat, center.lng, 5);
    // Expand neighbors depth based on radius (~4.9km cell at precision 5)
    const cellKm = 4.9;
    const steps = Math.max(0, Math.ceil((radiusMiles*1.60934)/cellKm) - 1);
    const prefixes = Array.from(expandNeighbors(gh, steps));

    let results = [];
    for (const p of prefixes) {
      const keyCond = ['gh5 = :gh'];
      const exprValues = { ':gh': p };
      // Query by start time to reduce scan width; overlap checks are filtered below
      if (startEpoch && endEpoch) {
        keyCond.push('dateTime BETWEEN :start AND :end');
        exprValues[':start'] = startEpoch; exprValues[':end'] = endEpoch;
      } else if (startEpoch) {
        keyCond.push('dateTime >= :start'); exprValues[':start'] = startEpoch;
      }
      const q = new QueryCommand({
        TableName: TABLE,
        IndexName: 'GeoTime',
        KeyConditionExpression: keyCond.join(' AND '),
        ExpressionAttributeValues: exprValues
      });
      const out = await ddb.send(q);
      results.push(...(out.Items || []));
    }

    // Deduplicate by eventId
    const map = new Map();
    for (const it of results) map.set(it.eventId, it);
    const unique = Array.from(map.values());

    // Filter by precise radius and sort by dateTime ascending
    let filtered = unique
      .map(it => {
        const c = it.coordinates || {};
        const d = (typeof c.lat==='number'&&typeof c.lng==='number') ? haversineMeters(center.lat, center.lng, c.lat, c.lng) : Infinity;
        return { ...it, _distanceMeters: d };
      })
      .filter(it => it._distanceMeters <= radiusMeters)
      // If caller provided a time window, ensure event overlaps that window using start (dateTime) and endTime
      .filter(it => {
        if (!startEpoch && !endEpoch) return true;
        const evStart = Number(it.dateTime || 0);
        const evEnd = Number(it.endTime || it.dateTime || 0);
        if (startEpoch && endEpoch) {
          // Overlap if evStart <= end AND evEnd >= start
          return evStart <= endEpoch && evEnd >= startEpoch;
        } else if (startEpoch) {
          // Event ends after start
          return evEnd >= startEpoch;
        }
        return true;
      })
      .sort((a,b) => a.dateTime - b.dateTime);

    // Optional: filter by tags (comma-separated), matches if any tag overlaps
    const requestedTags = canonicalizeTags(qs.tags);
    if (requestedTags.length > 0) {
      const set = new Set(requestedTags);
      filtered = filtered.filter(it => {
        const evTags = canonicalizeTags(Array.isArray(it.tags) ? it.tags : []);
        return evTags.some(t => set.has(t));
      });
    }

    const payload = { center, radiusMiles, count: filtered.length, items: filtered };
    if (startEpoch || endEpoch) {
      payload.timeRange = {};
      if (startEpoch) payload.timeRange.start = new Date(startEpoch * 1000).toISOString();
      if (endEpoch) payload.timeRange.end = new Date(endEpoch * 1000).toISOString();
    }

    return response(200, payload);
  } catch (err) {
    console.error('Search events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
