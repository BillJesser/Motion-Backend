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
import { UserPool, UserPoolClient, AccountRecovery, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';

class MotionBackendStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const usersTable = new Table(this, 'UsersTable', {
      tableName: 'MotionUsers',
      partitionKey: { name: 'email', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN // change to DESTROY for dev only
    });
    usersTable.addGlobalSecondaryIndex({
      indexName: 'BySub',
      partitionKey: { name: 'cognitoSub', type: AttributeType.STRING }
    });

    const userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: {
        adminUserPassword: true,
        userPassword: true
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      generateSecret: false
    });

    const commonEnv = {
      USERS_TABLE: usersTable.tableName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      APP_NAME: process.env.APP_NAME ?? 'Motion'
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

    const forgotPasswordFn = new NodejsFunction(this, 'ForgotPasswordFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/forgot-password.js',
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

    const confirmForgotPasswordFn = new NodejsFunction(this, 'ConfirmForgotPasswordFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/confirm-forgot-password.js',
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

    const confirmSignupFn = new NodejsFunction(this, 'ConfirmSignupFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/confirm-signup.js',
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

    const customMessageFn = new NodejsFunction(this, 'CustomMessageFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/auth/custom-message.js',
      handler: 'handler',
      environment: { APP_NAME: process.env.APP_NAME ?? 'Motion' },
      timeout: Duration.seconds(10),
      bundling: {
        format: 'esm',
        target: 'node20',
        minify: true,
        sourceMap: false,
      }
    });

    userPool.addTrigger(UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    httpApi.addRoutes({
      path: '/auth/confirm-signup',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ConfirmSignupIntegration', confirmSignupFn)
    });

    httpApi.addRoutes({
      path: '/users/saved-events',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SaveEventIntegration', saveEventFn)
    });

    httpApi.addRoutes({
      path: '/users/saved-events',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('RemoveSavedEventIntegration', removeSavedEventFn)
    });

    httpApi.addRoutes({
      path: '/users/saved-events',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetSavedEventsIntegration', getSavedEventsFn)
    });

    httpApi.addRoutes({
      path: '/users/profile',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetUserProfileIntegration', getUserProfileFn)
    });

    httpApi.addRoutes({
      path: '/events/{eventId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetEventIntegration', getEventFn)
    });

    httpApi.addRoutes({
      path: '/ai-events/{eventId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetAiEventIntegration', getAiEventFn)
    });

    new CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UsersTableName', { value: usersTable.tableName });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });

    // Events Table
    const eventsTable = new Table(this, 'EventsTable', {
      tableName: 'MotionEvents',
      partitionKey: { name: 'eventId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const aiEventsTable = new Table(this, 'AiEventsTable', {
      tableName: 'MotionAiEvents',
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
      AI_EVENTS_TABLE: aiEventsTable.tableName,
      PLACE_INDEX_NAME: placeIndex.indexName
    };

    const userFunctionsEnv = {
      USERS_TABLE: usersTable.tableName,
      EVENTS_TABLE: eventsTable.tableName,
      AI_EVENTS_TABLE: aiEventsTable.tableName
    };

    const saveEventFn = new NodejsFunction(this, 'SaveEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/users/save-event.js',
      handler: 'handler',
      environment: userFunctionsEnv,
      timeout: Duration.seconds(10),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    const removeSavedEventFn = new NodejsFunction(this, 'RemoveSavedEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/users/remove-saved-event.js',
      handler: 'handler',
      environment: userFunctionsEnv,
      timeout: Duration.seconds(10),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    const getUserProfileFn = new NodejsFunction(this, 'GetUserProfileFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/users/get-profile.js',
      handler: 'handler',
      environment: userFunctionsEnv,
      timeout: Duration.seconds(10),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    const getSavedEventsFn = new NodejsFunction(this, 'GetSavedEventsFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/users/get-saved-events.js',
      handler: 'handler',
      environment: userFunctionsEnv,
      timeout: Duration.seconds(15),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    const getEventFn = new NodejsFunction(this, 'GetEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/get-event.js',
      handler: 'handler',
      environment: { EVENTS_TABLE: eventsTable.tableName },
      timeout: Duration.seconds(10),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    const getAiEventFn = new NodejsFunction(this, 'GetAiEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/get-ai-event.js',
      handler: 'handler',
      environment: { AI_EVENTS_TABLE: aiEventsTable.tableName },
      timeout: Duration.seconds(10),
      bundling: { format: 'esm', target: 'node20', minify: true, sourceMap: false }
    });

    usersTable.grantReadWriteData(signupFn);
    usersTable.grantReadData(signinFn);
    usersTable.grantReadWriteData(confirmSignupFn);
    usersTable.grantReadWriteData(saveEventFn);
    usersTable.grantReadWriteData(removeSavedEventFn);
    usersTable.grantReadData(getUserProfileFn);
    usersTable.grantReadData(getSavedEventsFn);

    signupFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:SignUp',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminDeleteUser'
      ],
      resources: [userPool.userPoolArn]
    }));

    signinFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:AdminInitiateAuth',
        'cognito-idp:AdminGetUser'
      ],
      resources: [userPool.userPoolArn]
    }));

    forgotPasswordFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:ForgotPassword'
      ],
      resources: [userPool.userPoolArn]
    }));

    confirmForgotPasswordFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:ConfirmForgotPassword'
      ],
      resources: [userPool.userPoolArn]
    }));

    confirmSignupFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'cognito-idp:ConfirmSignUp'
      ],
      resources: [userPool.userPoolArn]
    }));

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

    httpApi.addRoutes({
      path: '/auth/forgot-password',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ForgotPasswordIntegration', forgotPasswordFn)
    });

    httpApi.addRoutes({
      path: '/auth/confirm-forgot-password',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ConfirmForgotPasswordIntegration', confirmForgotPasswordFn)
    });

    const createEventFn = new NodejsFunction(this, 'CreateEventFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'functions/events/create.js',
      handler: 'handler',
      environment: { ...commonEventEnv },
      timeout: Duration.seconds(15),
      bundling: { format: 'esm', target: 'node20', minify: true }
    });
    eventsTable.grantReadWriteData(createEventFn);
    eventsTable.grantReadData(saveEventFn);
    eventsTable.grantReadData(getSavedEventsFn);
    eventsTable.grantReadData(getEventFn);
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
    aiEventsTable.grantReadWriteData(saveEventFn);
    aiEventsTable.grantReadData(getSavedEventsFn);
    aiEventsTable.grantReadData(getAiEventFn);
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
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
        PLACE_INDEX_NAME: placeIndex.indexName
      },
      timeout: Duration.seconds(900),
      memorySize: 256,
      // Cheerio/Ajv pull in modules that use require('buffer') internally.
      // Use CJS bundling for this function to avoid ESM dynamic-require errors in Lambda.
      bundling: { format: 'cjs', target: 'node20', minify: true }
    });

    searchAiFn.addToRolePolicy(new PolicyStatement({
      actions: ['geo:SearchPlaceIndexForPosition'],
      resources: [`arn:aws:geo:${this.region}:${this.account}:place-index/${placeIndex.indexName}`]
    }));

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
    new CfnOutput(this, 'AiEventsTableName', { value: aiEventsTable.tableName });
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
