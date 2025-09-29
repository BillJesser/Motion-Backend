import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.USERS_TABLE || '';
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
    if (!TABLE || !USER_POOL_CLIENT_ID) {
      return response(500, { message: 'User pool not configured' });
    }

    const data = JSON.parse(event.body || '{}');
    const email = String(data.email || '').trim().toLowerCase();
    const confirmationCode = String(data.code || data.confirmationCode || '').trim();
    if (!email || !confirmationCode) {
      return response(400, { message: 'email and code are required' });
    }

    try {
      await cognito.send(new ConfirmSignUpCommand({
        ClientId: USER_POOL_CLIENT_ID,
        Username: email,
        ConfirmationCode: confirmationCode
      }));
    } catch (err) {
      if (err?.name === 'CodeMismatchException' || err?.name === 'ExpiredCodeException') {
        return response(400, { message: 'Invalid or expired confirmation code' });
      }
      if (err?.name === 'UserNotFoundException') {
        return response(404, { message: 'User not found' });
      }
      console.error('ConfirmSignUp error', err);
      return response(500, { message: 'Unable to confirm user' });
    }

    try {
      await dynamo.send(new UpdateCommand({
        TableName: TABLE,
        Key: { email },
        UpdateExpression: 'SET isVerified = :true, updatedAt = :ts',
        ExpressionAttributeValues: {
          ':true': true,
          ':ts': new Date().toISOString()
        },
        ConditionExpression: 'attribute_exists(email)'
      }));
    } catch (err) {
      console.error('Failed to update profile after confirmation', err);
    }

    return response(200, { message: 'Account verified successfully' });
  } catch (err) {
    console.error('Confirm signup handler error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};
