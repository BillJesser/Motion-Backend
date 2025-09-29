import { CognitoIdentityProviderClient, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

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
    const confirmationCode = String(data.code || data.confirmationCode || '').trim();
    const newPassword = data.newPassword || data.password || '';

    if (!email || !confirmationCode || !newPassword) {
      return response(400, { message: 'email, code, and newPassword are required' });
    }

    try {
      await cognito.send(new ConfirmForgotPasswordCommand({
        ClientId: USER_POOL_CLIENT_ID,
        Username: email,
        ConfirmationCode: confirmationCode,
        Password: newPassword
      }));
    } catch (err) {
      if (err?.name === 'CodeMismatchException' || err?.name === 'ExpiredCodeException') {
        return response(400, { message: 'Invalid or expired confirmation code' });
      }
      if (err?.name === 'UserNotFoundException') {
        // Avoid leaking info
        return response(400, { message: 'Invalid or expired confirmation code' });
      }
      console.error('ConfirmForgotPassword error', err);
      return response(500, { message: 'Unable to reset password' });
    }

    return response(200, { message: 'Password updated successfully' });
  } catch (err) {
    console.error('ConfirmForgotPassword handler error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
