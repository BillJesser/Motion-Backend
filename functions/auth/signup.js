import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.USERS_TABLE || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

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

async function getUserSub(username) {
  const out = await cognito.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username
  }));
  const subAttribute = (out?.UserAttributes || []).find(attr => attr.Name === 'sub');
  return subAttribute?.Value || null;
}

export const handler = async (event) => {
  try {
    if (!TABLE || !USER_POOL_ID) {
      return response(500, { message: 'User pool not configured' });
    }

    const data = JSON.parse(event.body || '{}');
    const { email, password } = data;
    if (!email || !password) {
      return response(400, { message: 'email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Prevent duplicates in our profile table
    const existingProfile = await dynamo.send(new GetCommand({
      TableName: TABLE,
      Key: { email: normalizedEmail }
    }));
    if (existingProfile?.Item) {
      return response(409, { message: 'User already exists' });
    }

    try {
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: normalizedEmail,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: normalizedEmail },
          { Name: 'email_verified', Value: 'true' }
        ]
      }));
    } catch (err) {
      if (err?.name === 'UsernameExistsException') {
        return response(409, { message: 'User already exists' });
      }
      console.error('AdminCreateUser failed', err);
      return response(500, { message: 'Unable to create user' });
    }

    try {
      await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: normalizedEmail,
        Password: password,
        Permanent: true
      }));
    } catch (err) {
      console.error('AdminSetUserPassword failed, rolling back user', err);
      try {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: normalizedEmail }));
      } catch (rollbackErr) {
        console.error('Failed to rollback Cognito user', rollbackErr);
      }
      return response(500, { message: 'Unable to create user' });
    }

    let cognitoSub = null;
    try {
      cognitoSub = await getUserSub(normalizedEmail);
    } catch (err) {
      console.error('Failed to fetch Cognito sub', err);
    }

    const timestamp = new Date().toISOString();
    const profile = {
      email: normalizedEmail,
      cognitoSub,
      createdAt: timestamp,
      updatedAt: timestamp,
      savedEvents: []
    };

    await dynamo.send(new PutCommand({
      TableName: TABLE,
      Item: profile,
      ConditionExpression: 'attribute_not_exists(email)'
    }));

    return response(201, { message: 'User created', userId: cognitoSub, email: normalizedEmail });
  } catch (err) {
    console.error('Signup error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
