#!/usr/bin/env bun

const outputs = await Bun.file('.cdk.outputs.json').json();
const stack = outputs.AppSyncLambdaCacheStack;

const apiUrl = stack.GraphQLApiUrl;
const apiKey = stack.GraphQLApiKey;
const cachedApiUrl = stack.GraphQLApiWithCacheUrl;
const cachedApiKey = stack.GraphQLApiWithCacheKey;

const bowlId = 1;

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

async function query(url: string, key: string, query: string, variables: any = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.json();
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log(`[${timestamp()}] === Test Script ===\n`);

// 1. pickFruit for bowlId 1 from non-cached API
console.log(`[${timestamp()}] 1. Pick fruit for bowl 1 (non-cached API)`);
const pick1 = await query(apiUrl, apiKey, `
  mutation PickFruit($bowlId: Int!) {
    pickFruit(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
console.log(`[${timestamp()}] Result: ${pick1.data.pickFruit.quantity}x ${pick1.data.pickFruit.type}`);
console.log('');

// 2. Get fruit from non-cached API 3 times
console.log(`[${timestamp()}] 2. Get fruit from non-cached API (3 times, ~5s each)`);
for (let i = 1; i <= 3; i++) {
  const start = Date.now();
  const result = await query(apiUrl, apiKey, `
    query GetFruit($bowlId: Int!) {
      fruit(bowlId: $bowlId) {
        type
        quantity
      }
    }
  `, { bowlId });
  const elapsed = Date.now() - start;
  console.log(`[${timestamp()}]   ${i}. ${result.data.fruit.quantity}x ${result.data.fruit.type} (${elapsed}ms)`);
}
console.log('');

// 3. Get fruit from cached API 3 times
console.log(`[${timestamp()}] 3. Get fruit from cached API (3 times, first ~5s, rest cached)`);
for (let i = 1; i <= 3; i++) {
  const start = Date.now();
  const result = await query(cachedApiUrl, cachedApiKey, `
    query GetFruit($bowlId: Int!) {
      fruit(bowlId: $bowlId) {
        type
        quantity
      }
    }
  `, { bowlId });
  const elapsed = Date.now() - start;
  console.log(`[${timestamp()}]   ${i}. ${result.data.fruit.quantity}x ${result.data.fruit.type} (${elapsed}ms)`);
}
console.log('');

// 4. pickFruit without eviction
console.log(`[${timestamp()}] 4. Pick fruit without eviction (cached API)`);
const pick2 = await query(cachedApiUrl, cachedApiKey, `
  mutation PickFruit($bowlId: Int!) {
    pickFruit(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
console.log(`[${timestamp()}] New fruit: ${pick2.data.pickFruit.quantity}x ${pick2.data.pickFruit.type}`);
console.log('');

// 5. Get fruit from both APIs to show stale cache
console.log(`[${timestamp()}] 5. Get fruit from both APIs (cached API is stale)`);
const nonCached = await query(apiUrl, apiKey, `
  query GetFruit($bowlId: Int!) {
    fruit(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
const cached = await query(cachedApiUrl, cachedApiKey, `
  query GetFruit($bowlId: Int!) {
    fruit(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
console.log(`[${timestamp()}] Non-cached API: ${nonCached.data.fruit.quantity}x ${nonCached.data.fruit.type}`);
console.log(`[${timestamp()}] Cached API (stale): ${cached.data.fruit.quantity}x ${cached.data.fruit.type}`);
console.log('');

// 6. pickFruitVtl with eviction
console.log(`[${timestamp()}] 6. Pick fruit with VTL eviction`);
const pick3 = await query(cachedApiUrl, cachedApiKey, `
  mutation PickFruitVtl($bowlId: Int!) {
    pickFruitVtl(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
console.log(`[${timestamp()}] New fruit: ${pick3.data.pickFruitVtl.quantity}x ${pick3.data.pickFruitVtl.type}`);
console.log('');

// 7. Verify cache was evicted
console.log(`[${timestamp()}] 7. Get fruit from cached API (cache evicted, 3 times)`);
for (let i = 1; i <= 3; i++) {
  const start = Date.now();
  const result = await query(cachedApiUrl, cachedApiKey, `
    query GetFruit($bowlId: Int!) {
      fruit(bowlId: $bowlId) {
        type
        quantity
      }
    }
  `, { bowlId });
  const elapsed = Date.now() - start;
  console.log(`[${timestamp()}]   ${i}. ${result.data.fruit.quantity}x ${result.data.fruit.type} (${elapsed}ms)`);
}
console.log('');

// 8. pickFruitJS with eviction
console.log(`[${timestamp()}] 8. Pick fruit with JS eviction`);
const pick4 = await query(cachedApiUrl, cachedApiKey, `
  mutation PickFruitJS($bowlId: Int!) {
    pickFruitJS(bowlId: $bowlId) {
      type
      quantity
    }
  }
`, { bowlId });
console.log(`[${timestamp()}] New fruit: ${pick4.data.pickFruitJS.quantity}x ${pick4.data.pickFruitJS.type}`);
console.log('');

// 9. Verify cache was evicted
console.log(`[${timestamp()}] 9. Get fruit from cached API (cache evicted, 3 times)`);
for (let i = 1; i <= 3; i++) {
  const start = Date.now();
  const result = await query(cachedApiUrl, cachedApiKey, `
    query GetFruit($bowlId: Int!) {
      fruit(bowlId: $bowlId) {
        type
        quantity
      }
    }
  `, { bowlId });
  const elapsed = Date.now() - start;
  console.log(`[${timestamp()}]   ${i}. ${result.data.fruit.quantity}x ${result.data.fruit.type} (${elapsed}ms)`);
}
console.log('');

console.log(`[${timestamp()}] === Test Complete ===`);

