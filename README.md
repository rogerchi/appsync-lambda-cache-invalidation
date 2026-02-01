# AppSync Lambda Cache Invalidation

Companion repo to the article: https://dev.to/aws-builders/appsync-cache-eviction-with-lambda-data-sources-2ne5

A demonstration of cache invalidation patterns for AWS AppSync when using Lambda data sources. Shows how to implement cache eviction using both VTL and JavaScript response mapping templates.

## Overview

This project demonstrates how to properly invalidate AppSync cache entries when Lambda mutations modify underlying data. It includes:

- Two GraphQL APIs (cached vs non-cached) backed by DynamoDB
- Query returns `Fruit` object (type, quantity) by bowlId with 5-second Lambda delay
- Cached API has 5-minute cache keyed by bowlId
- Three mutation variants demonstrating different cache invalidation approaches

## Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Non-Cached    │    │     Cached      │
│   GraphQL API   │    │   GraphQL API   │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌─────────────────┐
         │   DynamoDB      │
         │   Table         │
         └─────────────────┘
```

## Mutations

1. **`pickFruit`** - Updates data without cache eviction (demonstrates stale cache)
2. **`pickFruitVtl`** - Updates data with VTL-based cache eviction
3. **`pickFruitJS`** - Updates data with JavaScript-based cache eviction

## Cache Invalidation Pattern

Lambda functions return eviction metadata alongside results:

```javascript
return {
  __evictFromApiCache: [['Query', 'fruit', { 'context.arguments.bowlId': bowlId }]],
  type: fruitType,
  quantity: quantity
};
```

Response mapping templates process the eviction and clean the response:

**VTL:**
```vtl
#if (!$util.isNull($ctx.result['__evictFromApiCache']))
  #foreach($evict in $ctx.result['__evictFromApiCache'])
    $extensions.evictFromApiCache($evict[0], $evict[1], $evict[2])
  #end
#end

$util.qr($ctx.result.remove('__evictFromApiCache'))
$util.toJson($ctx.result)
```

**JavaScript:**
```javascript
if (ctx.result.__evictFromApiCache) {
  ctx.result.__evictFromApiCache.forEach(evict => {
    extensions.evictFromApiCache(evict[0], evict[1], evict[2]);
  });
  delete ctx.result.__evictFromApiCache;
}

return ctx.result;
```

## Getting Started

### Prerequisites

- Node.js 18+ with Bun runtime
- AWS CLI configured with appropriate permissions
- AWS CDK v2

### Installation

```bash
bun install
```

### Deployment

```bash
bun run deploy
```

This deploys the stack and outputs API URLs and keys to `.cdk.outputs.json`.

### Testing

```bash
bun run test
```

The test script demonstrates:
- Cache behavior (hits vs misses)
- Stale cache when mutations don't evict
- Successful cache eviction with VTL and JS approaches

### Expected Test Output

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

[21:02:44.906] 5. Get fruit from both APIs (cached API is stale)
[21:02:50.331] Non-cached API: 6x jackfruit
[21:02:50.331] Cached API (stale): 4x grape

[21:02:55.836] 7. Get fruit from cached API (cache evicted, 3 times)
[21:03:01.171]   1. 1x clementine (5335ms)
[21:03:01.449]   2. 1x clementine (277ms)
[21:03:01.562]   3. 1x clementine (113ms)
```

## Key Files

- `cdk/stack.ts` - Main CDK stack definition
- `cdk/fruit-api.ts` - Reusable AppSync API construct
- `cdk/schema-*.graphql` - GraphQL schemas
- `test-script.ts` - Comprehensive test demonstrating cache behavior

## GraphQL Schema

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

## Cache Configuration

- **Cache Type**: SMALL (smallest available)
- **Cache Behavior**: PER_RESOLVER_CACHING
- **TTL**: 5 minutes (300 seconds)
- **Cache Key**: `$context.arguments.bowlId`

## Cleanup

```bash
bun cdk destroy
```

## Learn More

- [AWS AppSync Caching](https://docs.aws.amazon.com/appsync/latest/devguide/enabling-caching.html)
- [Lambda Resolvers](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-context-reference.html#aws-appsync-resolver-context-reference-lambda)
- [VTL Reference](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-util-reference.html)
- [JavaScript Resolvers](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-js.html)
