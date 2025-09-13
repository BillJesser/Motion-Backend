// CDK App entrypoint (JavaScript for simplicity)
import * as cdk from 'aws-cdk-lib';
import { Stack, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, CorsHttpMethod, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

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
        format: 'cjs',
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
        format: 'cjs',
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
