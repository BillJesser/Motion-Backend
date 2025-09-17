import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LocationClient, SearchPlaceIndexForTextCommand } from '@aws-sdk/client-location';
import { encodeGeohash } from '../lib/geohash.js';
import { selectTags } from '../lib/classify.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const location = new LocationClient({});
const TABLE = process.env.EVENTS_TABLE;
const PLACE_INDEX_NAME = process.env.PLACE_INDEX_NAME;

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

async function geocodeIfNeeded(coords, locationInput) {
  if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') return coords;
  const textParts = [];
  if (locationInput?.address) textParts.push(locationInput.address);
  if (locationInput?.city) textParts.push(locationInput.city);
  if (locationInput?.state) textParts.push(locationInput.state);
  if (locationInput?.zip) textParts.push(locationInput.zip);
  const text = textParts.join(', ').trim();
  if (!text) return null;
  const out = await location.send(new SearchPlaceIndexForTextCommand({ IndexName: PLACE_INDEX_NAME, Text: text, MaxResults: 1 }));
  const place = out.Results?.[0]?.Place;
  const [lng, lat] = place?.Geometry?.Point || [];
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
}

export const handler = async (event) => {
  try {
    const data = JSON.parse(event.body || '{}');
    const { name, description, dateTime, endDateTime, endTime, createdByEmail, photoUrls, location: loc, coordinates } = data;
    if (!name || !createdByEmail || !dateTime || !(endDateTime || endTime)) {
      return response(400, { message: 'name, createdByEmail, dateTime (start) and endDateTime (or endTime) are required' });
    }
    const dt = Date.parse(dateTime);
    if (Number.isNaN(dt)) return response(400, { message: 'dateTime must be ISO-8601' });
    const endParsed = endTime ? Number(endTime)*1000 : Date.parse(endDateTime);
    if (Number.isNaN(endParsed)) return response(400, { message: 'endDateTime must be ISO-8601, or provide numeric endTime (epoch seconds)' });
    if (endParsed < dt) return response(400, { message: 'end time must be after start time' });

    const coords = await geocodeIfNeeded(coordinates, loc);
    if (!coords) return response(400, { message: 'Provide coordinates or a geocodable address/zip' });
    const gh = encodeGeohash(coords.lat, coords.lng, 6);
    const item = {
      eventId: randomUUID(),
      name,
      description: description || '',
      createdByEmail,
      dateTime: Math.floor(dt / 1000), // start time (epoch seconds)
      endTime: Math.floor(endParsed / 1000),
      location: loc || {},
      coordinates: { lat: coords.lat, lng: coords.lng },
      gh5: gh.slice(0, 5),
      geohash: gh,
      photoUrls: Array.isArray(photoUrls) ? photoUrls : [],
      // classify up to 3 tags from allowed list based on title and location
      tags: selectTags({ title: name, location: loc || {} })
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return response(201, { message: 'Event created', eventId: item.eventId });
  } catch (err) {
    console.error('Create event error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
