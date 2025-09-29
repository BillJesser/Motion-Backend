import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, SignUpCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.USERS_TABLE || '';
const USER_POOL_ID = process.env.USER_POOL_ID || '';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || '';

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
    if (!TABLE || !USER_POOL_ID || !USER_POOL_CLIENT_ID) {
      return response(500, { message: 'User pool not configured' });
    }

    const data = JSON.parse(event.body || '{}');
    const { email, password } = data;
    if (!email || !password) {
      return response(400, { message: 'email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingProfile = await dynamo.send(new GetCommand({
      TableName: TABLE,
      Key: { email: normalizedEmail }
    }));
    if (existingProfile?.Item) {
      return response(409, { message: 'User already exists' });
    }

    let cognitoSub = null;
    try {
      const signUpResult = await cognito.send(new SignUpCommand({
        ClientId: USER_POOL_CLIENT_ID,
        Username: normalizedEmail,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: normalizedEmail }
        ]
      }));
      cognitoSub = signUpResult?.UserSub || null;
    } catch (err) {
      if (err?.name === 'UsernameExistsException') {
        return response(409, { message: 'User already exists' });
      }
      console.error('SignUp failed', err);
      return response(500, { message: 'Unable to create user' });
    }

    const timestamp = new Date().toISOString();
    const profile = {
      email: normalizedEmail,
      cognitoSub,
      createdAt: timestamp,
      updatedAt: timestamp,
      savedEvents: [],
      isVerified: false
    };

    try {
      await dynamo.send(new PutCommand({
        TableName: TABLE,
        Item: profile,
        ConditionExpression: 'attribute_not_exists(email)'
      }));
    } catch (err) {
      console.error('Failed to persist user profile', err);
      if (normalizedEmail && USER_POOL_ID) {
        try {
          await cognito.send(new AdminDeleteUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: normalizedEmail
          }));
        } catch (cleanupErr) {
          console.error('Failed to cleanup Cognito user after profile error', cleanupErr);
        }
      }
      return response(500, { message: 'Unable to create user' });
    }

    return response(201, { message: 'Verification code sent', userId: cognitoSub, email: normalizedEmail });
  } catch (err) {
    console.error('Signup error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
