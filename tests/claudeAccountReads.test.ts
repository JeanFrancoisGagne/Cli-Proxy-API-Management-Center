import { expect, test } from 'bun:test';
import { createClaudeAccountReader } from '../src/services/api/claudeAccountReads';
import type { ApiCallResult } from '../src/services/api/apiCall';

const limited: ApiCallResult = {
  statusCode: 429,
  header: { 'Retry-After': ['360'] },
  bodyText: '',
  body: { error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } },
};

test('quota and reset-grant reads share the provider Retry-After window', async () => {
  let now = 1000;
  const calls: string[] = [];
  const { read } = createClaudeAccountReader({
    request: async (request) => {
      calls.push(request.url);
      return limited;
    },
    revision: () => 1,
    now: () => now,
    wallNow: () => Date.parse('2026-10-20T21:24:05Z'),
  });
  expect((await read('account-a', 'usage')).statusCode).toBe(429);
  now += 1000;
  expect((await read('account-a', 'reset-grants')).statusCode).toBe(429);
  expect((await read('account-a', 'usage')).statusCode).toBe(429);
  expect(calls).toEqual(['https://api.anthropic.com/api/oauth/usage']);
  now = 361_000;
  await read('account-a', 'usage');
  expect(calls).toHaveLength(2);
});

const success: ApiCallResult = { statusCode: 200, header: {}, bodyText: '', body: {} };
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

test('concurrent quota readers share one request and later explicit reads stay fresh', async () => {
  const pending = deferred<ApiCallResult>();
  let calls = 0;
  const { read } = createClaudeAccountReader({
    request: async () => {
      calls += 1;
      return calls === 1 ? pending.promise : success;
    },
    revision: () => 1,
    now: () => 1000,
    wallNow: () => 0,
  });
  const first = read(' account-a ', 'usage');
  const second = read('account-a', 'usage');
  expect(first).toBe(second);
  expect(calls).toBe(1);
  pending.resolve(success);
  expect(await first).toBe(success);
  await read('account-a', 'usage');
  expect(calls).toBe(2);
});

test('a usage throttle does not block another account or its profile endpoint', async () => {
  const calls: string[] = [];
  const { read } = createClaudeAccountReader({
    request: async (request) => {
      calls.push(`${request.authIndex}:${request.url}`);
      return request.authIndex === 'account-a' && request.url.endsWith('/usage')
        ? limited
        : success;
    },
    revision: () => 1,
    now: () => 1000,
    wallNow: () => 0,
  });
  await read('account-a', 'usage');
  expect((await read('account-a', 'profile')).statusCode).toBe(200);
  expect((await read('account-b', 'usage')).statusCode).toBe(200);
  expect(calls).toHaveLength(3);
});

test('HTTP-date Retry-After uses the provider clock and monotonic elapsed time', async () => {
  let now = 1000;
  let wallNow = Date.parse('2026-10-20T20:24:05Z');
  let calls = 0;
  const { read } = createClaudeAccountReader({
    request: async () => {
      calls += 1;
      return {
        ...limited,
        header: {
          'rEtRy-AfTeR': ['Tue, 20 Oct 2026 21:30:05 GMT'],
          Date: ['Tue, 20 Oct 2026 21:24:05 GMT'],
        },
      };
    },
    revision: () => 1,
    now: () => now,
    wallNow: () => wallNow,
  });
  await read('account-a', 'usage');
  now = 360_999;
  wallNow += 86400_000;
  await read('account-a', 'usage');
  expect(calls).toBe(1);
  now = 361_000;
  await read('account-a', 'usage');
  expect(calls).toBe(2);
});

test('a shorter concurrent throttle cannot shorten the existing Retry-After window', async () => {
  let now = 1000;
  let calls = 0;
  const short = deferred<ApiCallResult>();
  const { read } = createClaudeAccountReader({
    request: async (request) => {
      calls += 1;
      return request.url.includes('cedar_ember') ? short.promise : limited;
    },
    revision: () => 1,
    now: () => now,
    wallNow: () => 0,
  });
  const pending = read('account-a', 'reset-grants');
  await read('account-a', 'usage');
  short.resolve({ ...limited, header: { 'Retry-After': ['10'] } });
  await pending;
  now = 20_000;
  await read('account-a', 'usage');
  expect(calls).toBe(2);
});

test('connection changes reject stale responses and do not leak their throttle', async () => {
  let revision = 1;
  let calls = 0;
  const old = deferred<ApiCallResult>();
  const replacement = deferred<ApiCallResult>();
  const { read } = createClaudeAccountReader({
    request: async () => {
      calls += 1;
      return calls === 1 ? old.promise : replacement.promise;
    },
    revision: () => revision,
    now: () => 1000,
    wallNow: () => 0,
  });
  const oldRequest = read('account-a', 'usage');
  const oldRejection = oldRequest.then(
    () => undefined,
    (error: unknown) => error
  );
  revision = 2;
  const current = read('account-a', 'usage');
  old.resolve(limited);
  expect(await oldRejection).toMatchObject({ code: 'stale_connection' });
  expect(read('account-a', 'usage')).toBe(current);
  replacement.resolve(success);
  expect(await current).toBe(success);
  expect(calls).toBe(2);
});

test('transport failures release in-flight work and malformed headers create no throttle', async () => {
  for (const retryAfter of [undefined, '', 'invalid date', '-5', 'Infinity']) {
    let calls = 0;
    const failure = new Error('synthetic transport error');
    const { read } = createClaudeAccountReader({
      request: async () => {
        calls += 1;
        if (calls === 1) throw failure;
        return {
          ...limited,
          header: retryAfter === undefined ? {} : { 'Retry-After': [retryAfter] },
        };
      },
      revision: () => 1,
      now: () => 1000,
      wallNow: () => Date.parse('2026-10-20T21:24:05Z'),
    });
    await expect(read('account-a', 'usage')).rejects.toBe(failure);
    await read('account-a', 'usage');
    await read('account-a', 'usage');
    expect(calls).toBe(3);
  }
});

test('replacement rejects late old-token replies and preserves other account deadlines', async () => {
  const old = deferred<ApiCallResult>();
  let calls = 0;
  const reader = createClaudeAccountReader({
    request: async (request) => {
      calls += 1;
      if (request.authIndex === 'account-b') return limited;
      return calls === 2 ? old.promise : success;
    },
    revision: () => 1,
    now: () => 1000,
    wallNow: () => 0,
  });
  reader.observeCredentials([
    { authIndex: 'account-a', lastRefresh: '2026-10-20T20:00:00Z' },
    { authIndex: 'account-b', lastRefresh: '2026-10-20T20:00:00Z' },
  ]);
  await reader.read('account-b', 'usage');
  const pending = reader.read('account-a', 'usage');
  const rejection = pending.then(
    () => undefined,
    (error: unknown) => error
  );
  reader.observeCredentials([
    { authIndex: 'account-a', lastRefresh: '2026-10-20T21:30:00Z' },
    { authIndex: 'account-b', lastRefresh: '2026-10-20T20:00:00Z' },
  ]);
  expect((await reader.read('account-a', 'usage')).statusCode).toBe(200);
  old.resolve(limited);
  expect(await rejection).toMatchObject({ code: 'stale_credential' });
  expect((await reader.read('account-a', 'usage')).statusCode).toBe(200);
  expect((await reader.read('account-b', 'usage')).statusCode).toBe(429);
  expect(calls).toBe(4);
});

test('missing refresh metadata preserves deadlines and a full removal drops old state', async () => {
  let calls = 0;
  const reader = createClaudeAccountReader({
    request: async () => {
      calls += 1;
      return calls === 1 ? limited : success;
    },
    revision: () => 1,
    now: () => 1000,
    wallNow: () => 0,
  });
  reader.observeCredentials([{ authIndex: 'account-a', lastRefresh: '2026-10-20T20:00:00Z' }]);
  await reader.read('account-a', 'usage');
  reader.observeCredentials([{ authIndex: 'account-a', lastRefresh: null }]);
  expect((await reader.read('account-a', 'usage')).statusCode).toBe(429);
  expect(calls).toBe(1);
  reader.observeCredentials([]);
  expect((await reader.read('account-a', 'usage')).statusCode).toBe(200);
  expect(calls).toBe(2);
});
