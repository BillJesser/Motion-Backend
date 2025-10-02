import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

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
    const qs = event.queryStringParameters || {};
    const email = String(qs.email || '').trim().toLowerCase();
    if (!email) {
      return response(400, { message: 'email is required' });
    }
    const out = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { email } }));
    const user = out?.Item;
    if (!user) {
      return response(404, { message: 'User not found' });
    }

    const { passwordHash, passwordSalt, ...safeProfile } = user;
    return response(200, { profile: safeProfile });
  } catch (err) {
    console.error('Get profile error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
