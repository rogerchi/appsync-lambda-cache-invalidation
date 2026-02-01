# AppSync Cache Eviction with Lambda Data Sources

[AppSync](https://aws.amazon.com/appsync/) is a fully managed, serverless GraphQL API service from AWS.  It has the concept of [data sources](https://docs.aws.amazon.com/appsync/latest/devguide/data-source-components.html), which are direct connectors to various back end services and data stores, which are configured using either request and response templates when using the VTL resolver, or using some special JavaScript exports when using the JavaScript runtime resolver.  This is not to be confused with the Lambda data source, which allows custom logic to be written in an AWS Lambda function (NodeJS or any other supported runtime or image), and which is a separate concept and layer apart from the JavaScript resolver.  If you've only ever used AppSync with Lambda data sources, you may never have needed to work with the resolver mapping templates or code directly, as the service uses a default mapping configuration if one is not provided.

One feature of AppSync is the ability to enable a managed caching layer, which allows GraphQL responses to be stored in a cache and returned without requesting the data directly from the configured data source.  One key functionality for a cache is the ability to evict cached entries -- important especially if a mutation runs that would cause a cached query to become stale and return incorrect results.  This ability is found in the `extensions.evictFromApiCache()` function available only in the VTL mapping templates or JavaScript resolver code.  This article describes the way to utilize this extension if you are using a Lambda data source.


## The Pattern

The implementation involves two parts:

1. **Lambda returns eviction metadata** alongside the actual result
2. **Response mapping template** processes the eviction and cleans the response

### Lambda Response Structure

Your Lambda function should return eviction instructions as a sibling field:

```javascript
exports.handler = async (event) => {
  const bowlId = event.arguments.bowlId;
  
  // Update your data
  const fruitType = 'apple';
  const quantity = 5;
  await updateDatabase(bowlId, fruitType, quantity);
  
  // Return result with eviction metadata
  return {
    __evictFromApiCache: [['Query', 'fruit', { 'context.arguments.bowlId': bowlId }]],
    type: fruitType,
    quantity: quantity
  };
};
```

The `__evictFromApiCache` array contains:
- `'Query'` - Operation type to evict
- `'fruit'` - Field name to evict  
- `{ 'context.arguments.bowlId': bowlId }` - Cache key arguments

### VTL Response Mapping Template

```vtl
#if (!$util.isNull($ctx.result['__evictFromApiCache']))
  #foreach($evict in $ctx.result['__evictFromApiCache'])
    $extensions.evictFromApiCache($evict[0], $evict[1], $evict[2])
  #end

  $util.qr($ctx.result.remove('__evictFromApiCache'))
#end

$util.toJson($ctx.result)
```

### JavaScript Response Mapping Template

```javascript
import { util, extensions } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: { field: ctx.info.fieldName, arguments: ctx.args }
  };
}

export function response(ctx) {
  if (ctx.result.__evictFromApiCache) {
    ctx.result.__evictFromApiCache.forEach(evict => {
      extensions.evictFromApiCache(evict[0], evict[1], evict[2]);
    });
    delete ctx.result.__evictFromApiCache;
  }
  
  return ctx.result;
}
```

## CDK Implementation

### VTL Resolver

```typescript
const dataSource = api.addLambdaDataSource('PickFruitVtlDataSource', pickFruitLambda);

dataSource.createResolver('PickFruitVtlResolver', {
  typeName: 'Mutation',
  fieldName: 'pickFruitVtl',
  responseMappingTemplate: appsync.MappingTemplate.fromString(`
#if (!$util.isNull($ctx.result['__evictFromApiCache']))
  #foreach($evict in $ctx.result['__evictFromApiCache'])
    $extensions.evictFromApiCache($evict[0], $evict[1], $evict[2])
  #end
  $util.qr($ctx.result.remove('__evictFromApiCache'))
#end

$util.toJson($ctx.result)
  `),
});
```

### JavaScript Resolver

```typescript
const dataSource = api.addLambdaDataSource('PickFruitJSDataSource', pickFruitLambda);

new appsync.Resolver(this, 'PickFruitJSResolver', {
  api: this.api,
  typeName: 'Mutation',
  fieldName: 'pickFruitJS',
  dataSource: dataSource,
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
```

## Example Implementation

To demonstrate this pattern, I built a complete example with two GraphQL APIs backed by DynamoDB:

- **Non-cached API** - No caching, always hits Lambda (~5 seconds)
- **Cached API** - 5-minute cache with three mutation variants

### GraphQL Schema

```graphql
type Fruit {
  type: String
  quantity: Int
}

type Query {
  fruit(bowlId: Int!): Fruit
}

type Mutation {
  pickFruit(bowlId: Int!): Fruit      # No cache eviction
  pickFruitVtl(bowlId: Int!): Fruit   # VTL cache eviction
  pickFruitJS(bowlId: Int!): Fruit    # JS cache eviction
}
```

### Lambda Implementation

The Lambda functions include a 5-second delay to make cache behavior visible:

```javascript
exports.handler = async (event) => {
  await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate work
  
  const bowlId = event.arguments?.bowlId || event.bowlId;
  const fruits = ['apple', 'banana', 'orange', 'grape', 'mango'];
  const fruitType = fruits[Math.floor(Math.random() * fruits.length)];
  const quantity = Math.floor(Math.random() * 10) + 1;
  
  // Update DynamoDB
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      bowlId: { N: String(bowlId) },
      fruitType: { S: fruitType },
      quantity: { N: String(quantity) }
    }
  }));
  
  // Return with eviction metadata (for VTL/JS mutations only)
  return {
    __evictFromApiCache: [['Query', 'fruit', { 'context.arguments.bowlId': bowlId }]],
    type: fruitType,
    quantity
  };
};
```

## Test Results

Running the test script demonstrates the cache invalidation behavior:

```
[21:02:17.937] === Test Script ===

[21:02:17.947] 1. Pick fruit for bowl 1 (non-cached API)
[21:02:23.565] Result: 10x cantaloupe

[21:02:23.566] 2. Get fruit from non-cached API (3 times, ~5s each)
[21:02:28.915]   1. 10x cantaloupe (5349ms)
[21:02:34.034]   2. 10x cantaloupe (5118ms)
[21:02:39.179]   3. 10x cantaloupe (5144ms)

[21:02:39.180] 3. Get fruit from cached API (3 times, first ~5s, rest cached)
[21:02:39.411]   1. 4x grape (231ms)
[21:02:39.529]   2. 4x grape (118ms)
[21:02:39.637]   3. 4x grape (107ms)

[21:02:39.637] 4. Pick fruit without eviction (cached API)
[21:02:44.905] New fruit: 6x jackfruit

[21:02:44.906] 5. Get fruit from both APIs (cached API is stale)
[21:02:50.331] Non-cached API: 6x jackfruit
[21:02:50.331] Cached API (stale): 4x grape

[21:02:50.332] 6. Pick fruit with VTL eviction
[21:02:55.835] New fruit: 1x clementine

[21:02:55.836] 7. Get fruit from cached API (cache evicted, 3 times)
[21:03:01.171]   1. 1x clementine (5335ms)
[21:03:01.449]   2. 1x clementine (277ms)
[21:03:01.562]   3. 1x clementine (113ms)

[21:03:01.563] 8. Pick fruit with JS eviction
[21:03:07.213] New fruit: 4x strawberry

[21:03:07.214] 9. Get fruit from cached API (cache evicted, 3 times)
[21:03:12.436]   1. 4x strawberry (5222ms)
[21:03:12.537]   2. 4x strawberry (101ms)
[21:03:12.652]   3. 4x strawberry (114ms)

[21:03:12.653] === Test Complete ===
```

### Key Observations

1. **Non-cached API**: Every query takes ~5 seconds (always hits Lambda)
2. **Cached API**: First query ~5s, subsequent queries ~100ms (cache hit)
3. **Stale cache**: Step 5 shows cached API returning old data after mutation without eviction
4. **Successful eviction**: Steps 7 and 9 show cache cleared after VTL/JS mutations (first query ~5s, then cached)

The timing differences clearly demonstrate when the cache is working versus when it's been properly evicted and needs repopulation.

## Cache Key Format

The eviction key must exactly match your caching configuration. For a query with:

```typescript
cachingConfig: {
  ttl: cdk.Duration.seconds(300),
  cachingKeys: ['$context.arguments.bowlId'],
}
```

Use the eviction key format:

```javascript
{ 'context.arguments.bowlId': bowlId }
```

This pattern ensures your mutations properly invalidate the specific cache entries they affect, maintaining data consistency while preserving the performance benefits of caching.

[Complete working example available on GitHub](https://github.com/rogerchi/appsync-lambda-cache-invalidation)