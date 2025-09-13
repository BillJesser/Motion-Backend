const AWS = require('aws-sdk');
const { hashPassword } = require('../lib/crypto');

const dynamo = new AWS.DynamoDB.DocumentClient();
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
    const existing = await dynamo
      .get({ TableName: TABLE, Key: { email } })
      .promise();
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

    await dynamo
      .put({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(email)' })
      .promise();

    return response(201, { message: 'User created', userId, email });
  } catch (err) {
    console.error('Signup error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};

