import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { FruitApi } from './fruit-api';

export class AppSyncLambdaCacheStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'FruitTable', {
      partitionKey: { name: 'bowlId', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new FruitApi(this, 'FruitApi', {
      name: 'fruit-api',
      table,
      schemaFile: 'cdk/schema-regular.graphql',
      enableCache: false,
    });

    const apiWithCache = new FruitApi(this, 'FruitApiWithCache', {
      name: 'fruit-api-with-cache',
      table,
      schemaFile: 'cdk/schema-cached.graphql',
      enableCache: true,
      enableCacheEviction: true,
    });

    new cdk.CfnOutput(this, 'GraphQLApiUrl', {
      value: api.api.graphqlUrl,
    });

    new cdk.CfnOutput(this, 'GraphQLApiKey', {
      value: api.api.apiKey || '',
    });

    new cdk.CfnOutput(this, 'GraphQLApiWithCacheUrl', {
      value: apiWithCache.api.graphqlUrl,
    });

    new cdk.CfnOutput(this, 'GraphQLApiWithCacheKey', {
      value: apiWithCache.api.apiKey || '',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });
  }
}
