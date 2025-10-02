import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
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

export const handler = async (event) => {
  try {
    if (!AI_EVENTS_TABLE) {
      return response(500, { message: 'Service misconfigured' });
    }
    const eventId = event?.pathParameters?.eventId || (event?.queryStringParameters?.eventId);
    if (!eventId) {
      return response(400, { message: 'eventId is required' });
    }
    const out = await doc.send(new GetCommand({ TableName: AI_EVENTS_TABLE, Key: { eventId } }));
    if (!out?.Item) {
      return response(404, { message: 'Event not found' });
    }
    return response(200, { event: out.Item });
  } catch (err) {
    console.error('Get AI event error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
