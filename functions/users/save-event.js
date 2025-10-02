import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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

async function getUser(email) {
  const out = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
  return out?.Item || null;
}

async function motionEventExists(eventId) {
  if (!eventId) return false;
  const out = await doc.send(new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } }));
  return !!out?.Item;
}

async function upsertAiEvent(eventId, payload) {
  const now = new Date().toISOString();
  const item = {
    eventId,
    title: payload.title,
    description: payload.description || '',
    start_date: payload.start_date,
    end_date: payload.end_date || null,
    start_time: payload.start_time || null,
    end_time: payload.end_time || null,
    timezone: payload.timezone,
    location: payload.location || {},
    source_url: payload.source_url,
    organizer: payload.organizer || null,
    ticket_info: payload.ticket_info || null,
    media: payload.media || null,
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 5) : [],
    createdAt: now,
    updatedAt: now
  };
  try {
    await doc.send(new PutCommand({
      TableName: AI_EVENTS_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(eventId)'
    }));
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      await doc.send(new UpdateCommand({
        TableName: AI_EVENTS_TABLE,
        Key: { eventId },
        UpdateExpression: 'SET updatedAt = :u',
        ExpressionAttributeValues: { ':u': now }
      }));
    } else {
      throw err;
    }
  }
}

export const handler = async (event) => {
  try {
    if (!USERS_TABLE || !EVENTS_TABLE || !AI_EVENTS_TABLE) {
      return response(500, { message: 'Service misconfigured' });
    }

    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const source = String(body.source || '').trim().toLowerCase();

    if (!email || !source) {
      return response(400, { message: 'email and source are required' });
    }
    if (!['motion', 'ai'].includes(source)) {
      return response(400, { message: 'source must be "motion" or "ai"' });
    }

    const user = await getUser(email);
    if (!user) {
      return response(404, { message: 'User not found' });
    }
    if (user.isVerified === false) {
      return response(403, { message: 'Account is not verified' });
    }

    let eventId = body.eventId ? String(body.eventId).trim() : '';
    const nowIso = new Date().toISOString();

    if (source === 'motion') {
      if (!eventId) return response(400, { message: 'eventId is required for motion events' });
      const exists = await motionEventExists(eventId);
      if (!exists) {
        return response(404, { message: 'Motion event not found' });
      }
    } else {
      const payload = body.event || {};
      if (!payload.title || !payload.start_date || !payload.timezone || !payload.source_url) {
        return response(400, { message: 'event.title, event.start_date, event.timezone and event.source_url are required for AI events' });
      }
      if (!payload.location || typeof payload.location !== 'object') {
        payload.location = {};
      }
      eventId = eventId || randomUUID();
      try {
        await upsertAiEvent(eventId, payload);
      } catch (err) {
        console.error('Failed to save AI event', err);
        return response(500, { message: 'Unable to store AI event' });
      }
    }

    const savedEntry = { eventId, source };
    const savedEvents = Array.isArray(user.savedEvents) ? [...user.savedEvents] : [];
    const alreadySaved = savedEvents.some(e => e?.eventId === eventId && e?.source === source);
    if (!alreadySaved) {
      savedEvents.push(savedEntry);
    }

    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { email },
      UpdateExpression: 'SET savedEvents = :events, updatedAt = :ts',
      ExpressionAttributeValues: {
        ':events': savedEvents,
        ':ts': nowIso
      },
      ConditionExpression: 'attribute_exists(email)'
    }));

    return response(200, { message: 'Event saved', savedEvents });
  } catch (err) {
    console.error('Save event error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
