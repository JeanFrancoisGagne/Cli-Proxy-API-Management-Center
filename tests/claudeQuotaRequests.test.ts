import { afterEach, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import { CLAUDE_CONFIG } from '../src/features/quota/providers/claude/data';
import { readClaudeResetGrants } from '../src/services/api/claudeResetGrants';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import { apiClient } from '../src/services/api/client';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: {} });
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

test('the quota adapter and reset-grant API honor the same captured429 deadline', async () => {
  apiClient.setConfig({ apiBase: 'http://synthetic.example', managementKey: '' });
  const calls: ApiCallRequest[] = [];
  apiCallApi.request = async (request) => {
    calls.push(request);
    return request.url.includes('/usage')
      ? {
          statusCode: 429,
          header: { 'Retry-After': ['360'] },
          bodyText: '',
          body: {
            error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' },
          },
        }
      : { statusCode: 200, header: {}, bodyText: '', body: { account: { has_claude_max: true } } };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
    '429 Rate limited. Please try again later.'
  );
  await expect(readClaudeResetGrants('synthetic')).rejects.toMatchObject({ code: 'upstream' });
  await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
    '429 Rate limited. Please try again later.'
  );
  expect(calls.filter(({ url }) => url.includes('/usage'))).toHaveLength(1);
  expect(calls.some(({ url }) => url.includes('cedar_ember'))).toBe(false);
});

test('quota page and auth-file card callers coalesce concurrent reads of one account', async () => {
  apiClient.setConfig({ apiBase: 'http://synthetic.example', managementKey: '' });
  const calls: ApiCallRequest[] = [];
  apiCallApi.request = async (request) => {
    calls.push(request);
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body: request.url.endsWith('/profile')
        ? { account: { has_claude_max: true } }
        : { five_hour: { utilization: 42, resets_at: null } },
    };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  const [page, card] = await Promise.all([
    CLAUDE_CONFIG.fetchQuota(file, i18n.t),
    CLAUDE_CONFIG.fetchQuota(file, i18n.t),
  ]);
  expect(page).toEqual(card);
  expect(page.windows[0].usedPercent).toBe(42);
  expect(page.planType).toBe('plan_max');
  expect(calls).toHaveLength(2);
});

test('a successful token replacement in the inventory clears only that account throttle', async () => {
  apiClient.setConfig({ apiBase: 'http://synthetic.example', managementKey: '' });
  const { authFilesApi } = await import('../src/services/api/authFiles');
  const originalGet = apiClient.get;
  let lastRefresh = '2026-10-20T20:00:00Z';
  let priority = 10;
  let usageCalls = 0;
  apiClient.get = async () => ({
    files: [
      {
        name: 'synthetic.json',
        type: 'claude',
        auth_index: 'synthetic',
        last_refresh: lastRefresh,
        updated_at: '2026-10-20T21:00:00Z',
        priority,
      },
    ],
  });
  apiCallApi.request = async (request) => {
    if (request.url.endsWith('/profile'))
      return { statusCode: 200, header: {}, bodyText: '', body: {} };
    usageCalls += 1;
    return usageCalls === 1
      ? {
          statusCode: 429,
          header: { 'Retry-After': ['360'] },
          bodyText: '',
          body: { error: { message: 'Rate limited. Please try again later.' } },
        }
      : {
          statusCode: 200,
          header: {},
          bodyText: '',
          body: { five_hour: { utilization: 42, resets_at: null } },
        };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  try {
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    priority = 100;
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    expect(usageCalls).toBe(1);
    lastRefresh = '2026-10-20T21:30:00Z';
    await authFilesApi.list();
    expect((await CLAUDE_CONFIG.fetchQuota(file, i18n.t)).windows[0].usedPercent).toBe(42);
    expect(usageCalls).toBe(2);
  } finally {
    apiClient.get = originalGet;
  }
});

test('a late old inventory cannot remove the new credential throttle', async () => {
  apiClient.setConfig({ apiBase: 'http://synthetic.example', managementKey: '' });
  const { authFilesApi } = await import('../src/services/api/authFiles');
  const originalGet = apiClient.get;
  const inventory = (lastRefresh: string) => ({
    files: [
      {
        name: 'synthetic.json',
        type: 'claude',
        auth_index: 'synthetic',
        last_refresh: lastRefresh,
      },
    ],
  });
  let completeOld = (_value: ReturnType<typeof inventory>) => {};
  const old = new Promise<ReturnType<typeof inventory>>((resolve) => {
    completeOld = resolve;
  });
  let lists = 0;
  let usageCalls = 0;
  apiClient.get = async () => {
    lists += 1;
    if (lists === 2) return old;
    return inventory(lists === 1 ? '2026-10-20T20:00:00Z' : '2026-10-20T21:30:00Z');
  };
  apiCallApi.request = async (request) => {
    if (request.url.endsWith('/profile'))
      return { statusCode: 200, header: {}, bodyText: '', body: {} };
    usageCalls += 1;
    return usageCalls <= 2
      ? {
          statusCode: 429,
          header: { 'Retry-After': ['360'] },
          bodyText: '',
          body: { error: { message: 'Rate limited. Please try again later.' } },
        }
      : {
          statusCode: 200,
          header: {},
          bodyText: '',
          body: { five_hour: { utilization: 42, resets_at: null } },
        };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  try {
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    const pending = authFilesApi.list();
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    completeOld(inventory('2026-10-20T20:00:00Z'));
    await pending;
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    expect(usageCalls).toBe(2);
  } finally {
    apiClient.get = originalGet;
  }
});

test('an inventory from the previous connection cannot clear current throttles', async () => {
  apiClient.setConfig({ apiBase: 'http://old.synthetic.example', managementKey: '' });
  const { authFilesApi } = await import('../src/services/api/authFiles');
  const originalGet = apiClient.get;
  const inventory = {
    files: [
      {
        name: 'synthetic.json',
        type: 'claude',
        auth_index: 'synthetic',
        last_refresh: '2026-10-20T20:00:00Z',
      },
    ],
  };
  let completeOld = (_value: typeof inventory) => {};
  const old = new Promise<typeof inventory>((resolve) => {
    completeOld = resolve;
  });
  apiClient.get = async () => old;
  let usageCalls = 0;
  apiCallApi.request = async (request) => {
    if (request.url.endsWith('/profile'))
      return { statusCode: 200, header: {}, bodyText: '', body: {} };
    usageCalls += 1;
    return usageCalls === 1
      ? {
          statusCode: 429,
          header: { 'Retry-After': ['360'] },
          bodyText: '',
          body: { error: { message: 'Rate limited. Please try again later.' } },
        }
      : {
          statusCode: 200,
          header: {},
          bodyText: '',
          body: { five_hour: { utilization: 42, resets_at: null } },
        };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  try {
    const pending = authFilesApi.list();
    apiClient.setConfig({ apiBase: 'http://new.synthetic.example', managementKey: '' });
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    completeOld(inventory);
    await pending;
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    expect(usageCalls).toBe(1);
  } finally {
    apiClient.get = originalGet;
  }
});

test('lookup and malformed inventories preserve a known credential embargo', async () => {
  apiClient.setConfig({ apiBase: 'http://synthetic.example', managementKey: '' });
  const { authFilesApi } = await import('../src/services/api/authFiles');
  const originalGet = apiClient.get;
  let valid = true;
  apiClient.get = async () =>
    valid
      ? {
          files: [
            {
              name: 'synthetic.json',
              type: 'claude',
              auth_index: 'synthetic',
              last_refresh: '2026-10-20T20:00:00Z',
            },
          ],
        }
      : { files: null };
  let usageCalls = 0;
  apiCallApi.request = async (request) => {
    if (request.url.endsWith('/profile'))
      return { statusCode: 200, header: {}, bodyText: '', body: {} };
    usageCalls += 1;
    return {
      statusCode: 429,
      header: { 'Retry-After': ['360'] },
      bodyText: '',
      body: { error: { message: 'Rate limited. Please try again later.' } },
    };
  };
  const file = { name: 'synthetic.json', type: 'claude', auth_index: 'synthetic' };
  try {
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    await authFilesApi.list({ name: 'synthetic.json', authIndex: 'synthetic' });
    valid = false;
    await authFilesApi.list();
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('429');
    expect(usageCalls).toBe(1);
  } finally {
    apiClient.get = originalGet;
  }
});
