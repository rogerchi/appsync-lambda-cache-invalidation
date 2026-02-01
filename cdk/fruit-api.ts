import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface FruitApiProps {
  name: string;
  table: dynamodb.ITable;
  schemaFile: string;
  enableCache?: boolean;
  enableCacheEviction?: boolean;
}

export class FruitApi extends Construct {
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: FruitApiProps) {
    super(scope, id);

    const fruitLambda = new lambda.Function(this, 'FruitFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
      },
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
        const ddb = new DynamoDBClient();
        
        exports.handler = async (event) => {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const bowlId = event.arguments?.bowlId || event.bowlId;
          try {
            const result = await ddb.send(new GetItemCommand({
              TableName: process.env.TABLE_NAME,
              Key: { bowlId: { N: String(bowlId) } }
            }));
            if (!result.Item) return null;
            return {
              type: result.Item.fruitType?.S || null,
              quantity: result.Item.quantity?.N ? parseInt(result.Item.quantity.N) : null
            };
          } catch (error) {
            return null;
          }
        };
      `),
    });

    const pickFruitLambda = new lambda.Function(this, 'PickFruitFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
      },
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
        const ddb = new DynamoDBClient();
        
        exports.handler = async (event) => {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const bowlId = event.arguments?.bowlId || event.bowlId;
          const fruits = ['apple', 'banana', 'orange', 'grape', 'mango', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'pineapple', 'watermelon', 'cantaloupe', 'honeydew', 'kiwi', 'papaya', 'peach', 'pear', 'plum', 'cherry', 'apricot', 'lemon', 'lime', 'grapefruit', 'tangerine', 'pomegranate', 'coconut', 'fig', 'guava', 'lychee', 'passion fruit', 'dragon fruit', 'star fruit', 'persimmon', 'nectarine', 'cranberry', 'gooseberry', 'mulberry', 'elderberry', 'boysenberry', 'kumquat', 'clementine', 'mandarin', 'blood orange', 'plantain', 'date', 'prune', 'raisin', 'currant', 'quince', 'jackfruit'];
          const fruitType = fruits[Math.floor(Math.random() * fruits.length)];
          const quantity = Math.floor(Math.random() * 10) + 1;
          await ddb.send(new PutItemCommand({
            TableName: process.env.TABLE_NAME,
            Item: {
              bowlId: { N: String(bowlId) },
              fruitType: { S: fruitType },
              quantity: { N: String(quantity) }
            }
          }));
          return { type: fruitType, quantity };
        };
      `),
    });

    props.table.grantReadData(fruitLambda);
    props.table.grantWriteData(pickFruitLambda);

    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: props.name,
      definition: appsync.Definition.fromFile(props.schemaFile),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
        },
      },
    });

    if (props.enableCache) {
      new appsync.CfnApiCache(this, 'Cache', {
        apiCachingBehavior: 'PER_RESOLVER_CACHING',
        apiId: this.api.apiId,
        type: 'SMALL',
        ttl: 300,
      });
    }

    const fruitDataSource = this.api.addLambdaDataSource('FruitDataSource', fruitLambda);
    const pickFruitDataSource = this.api.addLambdaDataSource('PickFruitDataSource', pickFruitLambda);

    fruitDataSource.createResolver('FruitResolver', {
      typeName: 'Query',
      fieldName: 'fruit',
      cachingConfig: props.enableCache ? {
        ttl: cdk.Duration.seconds(300),
        cachingKeys: ['$context.arguments.bowlId'],
      } : undefined,
    });

    pickFruitDataSource.createResolver('PickFruitResolver', {
      typeName: 'Mutation',
      fieldName: 'pickFruit',
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    if (props.enableCacheEviction) {
      const pickFruitVtlLambda = new lambda.Function(this, 'PickFruitVtlFunction', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        timeout: cdk.Duration.seconds(10),
        environment: {
          TABLE_NAME: props.table.tableName,
        },
        code: lambda.Code.fromInline(`
          const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
          const ddb = new DynamoDBClient();
          
          exports.handler = async (event) => {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const bowlId = event.arguments?.bowlId || event.bowlId;
            const fruits = ['apple', 'banana', 'orange', 'grape', 'mango', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'pineapple', 'watermelon', 'cantaloupe', 'honeydew', 'kiwi', 'papaya', 'peach', 'pear', 'plum', 'cherry', 'apricot', 'lemon', 'lime', 'grapefruit', 'tangerine', 'pomegranate', 'coconut', 'fig', 'guava', 'lychee', 'passion fruit', 'dragon fruit', 'star fruit', 'persimmon', 'nectarine', 'cranberry', 'gooseberry', 'mulberry', 'elderberry', 'boysenberry', 'kumquat', 'clementine', 'mandarin', 'blood orange', 'plantain', 'date', 'prune', 'raisin', 'currant', 'quince', 'jackfruit'];
            const fruitType = fruits[Math.floor(Math.random() * fruits.length)];
            const quantity = Math.floor(Math.random() * 10) + 1;
            await ddb.send(new PutItemCommand({
              TableName: process.env.TABLE_NAME,
              Item: {
                bowlId: { N: String(bowlId) },
                fruitType: { S: fruitType },
                quantity: { N: String(quantity) }
              }
            }));
            return {
              __evictFromApiCache: [['Query', 'fruit', { 'context.arguments.bowlId': bowlId }]],
              type: fruitType,
              quantity
            };
          };
        `),
      });

      props.table.grantWriteData(pickFruitVtlLambda);

      const pickFruitVtlDataSource = this.api.addLambdaDataSource('PickFruitVtlDataSource', pickFruitVtlLambda);

      pickFruitVtlDataSource.createResolver('PickFruitVtlResolver', {
        typeName: 'Mutation',
        fieldName: 'pickFruitVtl',
        responseMappingTemplate: appsync.MappingTemplate.fromString(`
#if (!$util.isNull($ctx.result.error))
  $util.error($ctx.result.error.message, $ctx.result.error.type)
#end

#if (!$util.isNull($ctx.result['__evictFromApiCache']))
  #foreach($evict in $ctx.result['__evictFromApiCache'])
    $extensions.evictFromApiCache($evict[0], $evict[1], $evict[2])
  #end
#end

$util.qr($ctx.result.remove('__evictFromApiCache'))
$util.toJson($ctx.result)
        `),
      });

      const pickFruitJSLambda = new lambda.Function(this, 'PickFruitJSFunction', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        timeout: cdk.Duration.seconds(10),
        environment: {
          TABLE_NAME: props.table.tableName,
        },
        code: lambda.Code.fromInline(`
          const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
          const ddb = new DynamoDBClient();
          
          exports.handler = async (event) => {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const bowlId = event.arguments?.bowlId || event.bowlId;
            const fruits = ['apple', 'banana', 'orange', 'grape', 'mango', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'pineapple', 'watermelon', 'cantaloupe', 'honeydew', 'kiwi', 'papaya', 'peach', 'pear', 'plum', 'cherry', 'apricot', 'lemon', 'lime', 'grapefruit', 'tangerine', 'pomegranate', 'coconut', 'fig', 'guava', 'lychee', 'passion fruit', 'dragon fruit', 'star fruit', 'persimmon', 'nectarine', 'cranberry', 'gooseberry', 'mulberry', 'elderberry', 'boysenberry', 'kumquat', 'clementine', 'mandarin', 'blood orange', 'plantain', 'date', 'prune', 'raisin', 'currant', 'quince', 'jackfruit'];
            const fruitType = fruits[Math.floor(Math.random() * fruits.length)];
            const quantity = Math.floor(Math.random() * 10) + 1;
            await ddb.send(new PutItemCommand({
              TableName: process.env.TABLE_NAME,
              Item: {
                bowlId: { N: String(bowlId) },
                fruitType: { S: fruitType },
                quantity: { N: String(quantity) }
              }
            }));
            return {
              __evictFromApiCache: [['Query', 'fruit', { 'context.arguments.bowlId': bowlId }]],
              type: fruitType,
              quantity
            };
          };
        `),
      });

      props.table.grantWriteData(pickFruitJSLambda);

      const pickFruitJSDataSource = this.api.addLambdaDataSource('PickFruitJSDataSource', pickFruitJSLambda);

      new appsync.Resolver(this, 'PickFruitJSResolver', {
        api: this.api,
        typeName: 'Mutation',
        fieldName: 'pickFruitJS',
        dataSource: pickFruitJSDataSource,
        runtime: appsync.FunctionRuntime.JS_1_0_0,
        code: appsync.Code.fromInline(`
import { util, extensions } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: { field: ctx.info.fieldName, arguments: ctx.args }
  };
}

export function response(ctx) {
  if (ctx.result.error) {
    util.error(ctx.result.error.message, ctx.result.error.type);
  }
  
  if (ctx.result.__evictFromApiCache) {
    ctx.result.__evictFromApiCache.forEach(evict => {
      extensions.evictFromApiCache(evict[0], evict[1], evict[2]);
    });
    delete ctx.result.__evictFromApiCache;
  }
  
  return ctx.result;
}
        `),
      });
    }
  }
}
