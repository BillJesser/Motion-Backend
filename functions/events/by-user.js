import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.EVENTS_TABLE;

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const email = (qs.email || '').trim();
    if (!email) return response(400, { message: 'email is required' });

    const limit = Math.min(1000, Number(qs.limit || 200));

    let items = [];
    let ExclusiveStartKey;
    do {
      const out = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'ByCreatorTime',
        KeyConditionExpression: 'createdByEmail = :e',
        ExpressionAttributeValues: { ':e': email },
        ScanIndexForward: false, // most recent first
        ExclusiveStartKey,
        Limit: limit - items.length
      }));
      items.push(...(out.Items || []));
      ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey && items.length < limit);

    return response(200, { count: items.length, items });
  } catch (err) {
    console.error('By-user events error', err);
    return response(500, { message: 'Internal Server Error' });
  }
};

