const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { hashPassword } = require('../lib/crypto');

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE = process.env.USERS_TABLE;

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

exports.handler = async (event) => {
  try {
    const data = JSON.parse(event.body || '{}');
    const { email, password } = data;
    if (!email || !password) {
      return response(400, { message: 'email and password are required' });
    }

    // Check if user exists
    const existing = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { email } }));
    if (existing && existing.Item) {
      return response(409, { message: 'User already exists' });
    }

    const { salt, hash } = hashPassword(password);
    const userId = (crypto => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomBytes(16).toString('hex')))(require('crypto'));
    const item = {
      email,
      userId,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };

    await dynamo.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(email)' }));

    return response(201, { message: 'User created', userId, email });
  } catch (err) {
    console.error('Signup error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
