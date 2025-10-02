import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS_TABLE = process.env.USERS_TABLE || '';

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

export const handler = async (event) => {
  try {
    if (!USERS_TABLE) {
      return response(500, { message: 'Service misconfigured' });
    }
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const eventId = String(body.eventId || '').trim();
    const source = body.source ? String(body.source).trim().toLowerCase() : undefined;

    if (!email || !eventId) {
      return response(400, { message: 'email and eventId are required' });
    }

    const userOut = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
    const user = userOut?.Item;
    if (!user) {
      return response(404, { message: 'User not found' });
    }

    const savedEvents = Array.isArray(user.savedEvents) ? [...user.savedEvents] : [];
    const filtered = savedEvents.filter(entry => {
      if (!entry || typeof entry !== 'object') return false;
      if (entry.eventId !== eventId) return true;
      if (source && entry.source !== source) return true;
      return false;
    });

    if (filtered.length === savedEvents.length) {
      return response(200, { message: 'Event not found in saved list', savedEvents });
    }

    await doc.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { email },
      UpdateExpression: 'SET savedEvents = :events, updatedAt = :ts',
      ExpressionAttributeValues: {
        ':events': filtered,
        ':ts': new Date().toISOString()
      },
      ConditionExpression: 'attribute_exists(email)'
    }));

    return response(200, { message: 'Event removed', savedEvents: filtered });
  } catch (err) {
    console.error('Remove saved event error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
