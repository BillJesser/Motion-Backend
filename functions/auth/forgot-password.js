import { CognitoIdentityProviderClient, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});
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
    if (!USER_POOL_ID || !USER_POOL_CLIENT_ID) {
      return response(500, { message: 'User pool not configured' });
    }

    const data = JSON.parse(event.body || '{}');
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) {
      return response(400, { message: 'email is required' });
    }

    try {
      await cognito.send(new ForgotPasswordCommand({
        ClientId: USER_POOL_CLIENT_ID,
        Username: email
      }));
    } catch (err) {
      if (err?.name === 'UserNotFoundException') {
        // Do not leak existence; return success for idempotency
        return response(200, { message: 'If an account exists, a reset code has been sent' });
      }
      console.error('ForgotPassword error', err);
      return response(500, { message: 'Unable to initiate password reset' });
    }

    return response(200, { message: 'If an account exists, a reset code has been sent' });
  } catch (err) {
    console.error('ForgotPassword handler error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
