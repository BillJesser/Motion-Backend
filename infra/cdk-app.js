// CDK App entrypoint (JavaScript for simplicity)
import * as cdk from 'aws-cdk-lib';
import { Stack, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, FunctionUrlAuthType, HttpMethod as LambdaHttpMethod } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, CorsHttpMethod, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { CfnPlaceIndex } from 'aws-cdk-lib/aws-location';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

class MotionBackendStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const usersTable = new Table(this, 'UsersTable', {
      tableName: 'MotionUsers',
      partitionKey: { name: 'email', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN // change to DESTROY for dev only
    });

    const commonEnv = {
      USERS_TABLE: usersTable.tableName,
      JWT_SECRET: process.env.JWT_SECRET ?? ''
    };

    const signupFn = new NodejsFunction(this, 'SignupFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/signup.js',
      handler: 'handler',
      environment: commonEnv,
      timeout: Duration.seconds(10),
      bundling: {
        format: 'esm',
        target: 'node20',
        minify: true,
        sourceMap: false,
      }
    });

    const signinFn = new NodejsFunction(this, 'SigninFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/signin.js',
      handler: 'handler',
      environment: commonEnv,
      timeout: Duration.seconds(10),
      bundling: {
        format: 'esm',
        target: 'node20',
        minify: true,
        sourceMap: false,
      }
    });

    usersTable.grantReadWriteData(signupFn);
    usersTable.grantReadData(signinFn);

    const httpApi = new HttpApi(this, 'MotionHttpApi', {
      apiName: 'motion-api',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.OPTIONS
        ],
        allowOrigins: ['*']
      }
    });

    httpApi.addRoutes({
      path: '/auth/signup',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SignupIntegration', signupFn)
    });

    httpApi.addRoutes({
      path: '/auth/signin',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SigninIntegration', signinFn)
    });

    new CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UsersTableName', { value: usersTable.tableName });

    // Events Table
    const eventsTable = new Table(this, 'EventsTable', {
      tableName: 'MotionEvents',
      partitionKey: { name: 'eventId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN
    });
    // Add a GSI for geospatial + time queries. Partition by geohash prefix (length 5), sort by timestamp
    eventsTable.addGlobalSecondaryIndex({
      indexName: 'GeoTime',
      partitionKey: { name: 'gh5', type: AttributeType.STRING },
      sortKey: { name: 'dateTime', type: AttributeType.NUMBER }
    });
    // Add a GSI to fetch events by creator email, sorted by start time
    eventsTable.addGlobalSecondaryIndex({
      indexName: 'ByCreatorTime',
      partitionKey: { name: 'createdByEmail', type: AttributeType.STRING },
      sortKey: { name: 'dateTime', type: AttributeType.NUMBER }
    });

    // Amazon Location Place Index for geocoding zip/address to coordinates
    const placeIndex = new CfnPlaceIndex(this, 'PlaceIndex', {
      dataSource: 'Esri',
      indexName: 'motion-place-index'
    });

    const commonEventEnv = {
      EVENTS_TABLE: eventsTable.tableName,
      PLACE_INDEX_NAME: placeIndex.indexName
    };

    const createEventFn = new NodejsFunction(this, 'CreateEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/create.js',
      handler: 'handler',
      environment: { ...commonEventEnv },
      timeout: Duration.seconds(15),
      bundling: { format: 'esm', target: 'node20', minify: true }
    });
    eventsTable.grantReadWriteData(createEventFn);
    // Allow geocoding from Amazon Location
    createEventFn.addToRolePolicy(new PolicyStatement({
      actions: ['geo:SearchPlaceIndexForText'],
      resources: [
        `arn:aws:geo:${this.region}:${this.account}:place-index/${placeIndex.indexName}`
      ]
    }));

    const searchEventsFn = new NodejsFunction(this, 'SearchEventsFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/search.js',
      handler: 'handler',
      environment: { ...commonEventEnv },
      timeout: Duration.seconds(15),
      bundling: { format: 'esm', target: 'node20', minify: true }
    });
    eventsTable.grantReadData(searchEventsFn);
    searchEventsFn.addToRolePolicy(new PolicyStatement({
      actions: ['geo:SearchPlaceIndexForText'],
      resources: [
        `arn:aws:geo:${this.region}:${this.account}:place-index/${placeIndex.indexName}`
      ]
    }));

    const byUserEventsFn = new NodejsFunction(this, 'ByUserEventsFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/by-user.js',
      handler: 'handler',
      environment: { ...commonEventEnv },
      timeout: Duration.seconds(15),
      bundling: { format: 'esm', target: 'node20', minify: true }
    });
    eventsTable.grantReadData(byUserEventsFn);

    httpApi.addRoutes({
      path: '/events',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateEventIntegration', createEventFn)
    });

    httpApi.addRoutes({
      path: '/events/search',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SearchEventsIntegration', searchEventsFn)
    });

    httpApi.addRoutes({
      path: '/events/by-user',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ByUserEventsIntegration', byUserEventsFn)
    });

    // AI-powered web search for events
    const searchAiFn = new NodejsFunction(this, 'SearchAiEventsFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/search-ai.js',
      handler: 'handler',
      environment: {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? ''
      },
      timeout: Duration.seconds(900),
      memorySize: 256,
      // Cheerio/Ajv pull in modules that use require('buffer') internally.
      // Use CJS bundling for this function to avoid ESM dynamic-require errors in Lambda.
      bundling: { format: 'cjs', target: 'node20', minify: true }
    });

    httpApi.addRoutes({
      path: '/events/search-ai',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SearchAiEventsIntegration', searchAiFn)
    });

    // Also expose a Lambda Function URL for longer-running requests (bypasses API GW 30s limit)
    const searchAiFnUrl = searchAiFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        allowedMethods: [LambdaHttpMethod.GET]
      }
    });

    new CfnOutput(this, 'SearchAiFunctionUrl', { value: searchAiFnUrl.url });

    new CfnOutput(this, 'EventsTableName', { value: eventsTable.tableName });
  }
}

const app = new cdk.App();
const stackName = process.env.STACK_NAME || 'MotionBackendStack';
new MotionBackendStack(app, stackName, {
  env: {
    // CDK infers from GitHub Actions OIDC or your local AWS profile
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION
  }
});
