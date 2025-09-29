import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminInitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

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

async function initiateAuth(username, password) {
  const command = new AdminInitiateAuthCommand({
    UserPoolId: USER_POOL_ID,
    ClientId: USER_POOL_CLIENT_ID,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password
    }
  });
  return cognito.send(command);
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
    let authResult;
    try {
      const authResponse = await initiateAuth(normalizedEmail, password);
      if (authResponse.ChallengeName) {
        // Currently we do not support MFA or other challenges via API
        return response(403, { message: `Additional authentication required: ${authResponse.ChallengeName}` });
      }
      authResult = authResponse.AuthenticationResult;
    } catch (err) {
      if (err?.name === 'NotAuthorizedException' || err?.name === 'UserNotFoundException') {
        return response(401, { message: 'Invalid credentials' });
      }
      console.error('AdminInitiateAuth failed', err);
      return response(500, { message: 'Unable to sign in' });
    }

    if (!authResult?.AccessToken || !authResult?.IdToken) {
      return response(500, { message: 'Authentication failed' });
    }

    let profile = null;
    try {
      const profileResp = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { email: normalizedEmail } }));
      profile = profileResp?.Item || null;
    } catch (err) {
      console.error('Failed to load user profile', err);
    }

    return response(200, {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
      expiresIn: authResult.ExpiresIn,
      tokenType: authResult.TokenType,
      user: {
        email: normalizedEmail,
        userId: profile?.cognitoSub || null,
        savedEvents: profile?.savedEvents || []
      }
    });
  } catch (err) {
    console.error('Signin error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
