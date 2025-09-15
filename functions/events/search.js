import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LocationClient, SearchPlaceIndexForTextCommand } from '@aws-sdk/client-location';
import { encodeGeohash, expandNeighbors } from '../lib/geohash.js';
import { haversineMeters } from '../lib/geo.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const location = new LocationClient({});
const TABLE = process.env.EVENTS_TABLE;
const PLACE_INDEX_NAME = process.env.PLACE_INDEX_NAME;

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

async function resolveCenter(query) {
  if (query.lat && query.lng) return { lat: Number(query.lat), lng: Number(query.lng) };
  const text = query.address || query.zip || '';
  if (!text) return null;
  const out = await location.send(new SearchPlaceIndexForTextCommand({ IndexName: PLACE_INDEX_NAME, Text: String(text), MaxResults: 1 }));
  const place = out.Results?.[0]?.Place;
  const [lng, lat] = place?.Geometry?.Point || [];
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
}

export const handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const center = await resolveCenter({ lat: qs.lat, lng: qs.lng, address: qs.address, zip: qs.zip });
    if (!center) return response(400, { message: 'Provide lat/lng or address/zip' });

    const radiusMiles = Math.max(0.1, Number(qs.radiusMiles || 10));
    const radiusMeters = radiusMiles * 1609.34;
    const startIso = qs.startTime; // ISO
    const endIso = qs.endTime;
    const startEpoch = startIso ? Math.floor(Date.parse(startIso)/1000) : undefined;
    const endEpoch = endIso ? Math.floor(Date.parse(endIso)/1000) : undefined;

    const gh = encodeGeohash(center.lat, center.lng, 5);
    // Expand neighbors depth based on radius (~4.9km cell at precision 5)
    const cellKm = 4.9;
    const steps = Math.max(0, Math.ceil((radiusMiles*1.60934)/cellKm) - 1);
    const prefixes = Array.from(expandNeighbors(gh, steps));

    let results = [];
    for (const p of prefixes) {
      const keyCond = ['gh5 = :gh'];
      const exprValues = { ':gh': p };
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
    const filtered = unique
      .map(it => {
        const c = it.coordinates || {};
        const d = (typeof c.lat==='number'&&typeof c.lng==='number') ? haversineMeters(center.lat, center.lng, c.lat, c.lng) : Infinity;
        return { ...it, _distanceMeters: d };
      })
      .filter(it => it._distanceMeters <= radiusMeters)
      .sort((a,b) => a.dateTime - b.dateTime);

    return response(200, { center, radiusMiles, count: filtered.length, items: filtered });
  } catch (err) {
    console.error('Search events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};

