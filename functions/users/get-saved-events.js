import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS_TABLE = process.env.USERS_TABLE || '';
const EVENTS_TABLE = process.env.EVENTS_TABLE || '';
const AI_EVENTS_TABLE = process.env.AI_EVENTS_TABLE || '';

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    body: JSON.stringify(body)
  };
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function batchGet(tableName, keys) {
  if (keys.length === 0) return {};
  const results = {};
  for (const batch of chunk(keys, 100)) {
    const command = new BatchGetCommand({
      RequestItems: {
        [tableName]: { Keys: batch }
      }
    });
    const out = await doc.send(command);
    const items = out?.Responses?.[tableName] || [];
    for (const item of items) {
      results[item.eventId] = item;
    }
  }
  return results;
}

export const handler = async (event) => {
  try {
    if (!USERS_TABLE || !EVENTS_TABLE || !AI_EVENTS_TABLE) {
      return response(500, { message: 'Service misconfigured' });
    }

    const qs = event.queryStringParameters || {};
    const email = String(qs.email || '').trim().toLowerCase();
    if (!email) {
      return response(400, { message: 'email is required' });
    }

    const userOut = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
    const user = userOut?.Item;
    if (!user) {
      return response(404, { message: 'User not found' });
    }

    const savedEvents = Array.isArray(user.savedEvents) ? user.savedEvents : [];
    if (savedEvents.length === 0) {
      return response(200, { count: 0, items: [] });
    }

    const motionKeys = [];
    const aiKeys = [];
    for (const entry of savedEvents) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.source === 'ai') {
        aiKeys.push({ eventId: entry.eventId });
      } else {
        motionKeys.push({ eventId: entry.eventId });
      }
    }

    const [motionMap, aiMap] = await Promise.all([
      batchGet(EVENTS_TABLE, motionKeys),
      batchGet(AI_EVENTS_TABLE, aiKeys)
    ]);

    const detailed = savedEvents.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const { eventId, source } = entry;
      const data = source === 'ai' ? aiMap[eventId] : motionMap[eventId];
      return {
        eventId,
        source,
        event: data || null
      };
    });

    return response(200, { count: savedEvents.length, items: detailed });
  } catch (err) {
    console.error('Get saved events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
