import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyPassword, signJwt } from '../lib/crypto.js';

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE = process.env.USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET || '';

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
    const data = JSON.parse(event.body || '{}');
    const { email, password } = data;
    if (!email || !password) {
      return response(400, { message: 'email and password are required' });
    }
    const user = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { email } }));
    if (!user || !user.Item) {
      return response(401, { message: 'Invalid credentials' });
    }
    const { passwordSalt, passwordHash, userId } = user.Item;
    const ok = verifyPassword(password, passwordSalt, passwordHash);
    if (!ok) {
      return response(401, { message: 'Invalid credentials' });
    }
    if (!JWT_SECRET) {
      console.warn('JWT_SECRET not set; returning session without token');
      return response(200, { userId, email });
    }
    const token = signJwt({ sub: userId, email }, JWT_SECRET, { expiresIn: 60 * 60 * 24 });
    return response(200, { token, userId, email });
  } catch (err) {
    console.error('Signin error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
