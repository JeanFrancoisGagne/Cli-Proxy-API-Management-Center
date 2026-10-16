import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { accountsApi, parseAccountOverview } from '@/services/api/accounts';
import { apiClient } from '@/services/api/client';
import { AxiosHeaders } from 'axios';
import { createAccountOverviewStore } from '@/features/accounts/overviewStore';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AccountTable } from '@/features/accounts/AccountTable';
import { AccountDetails } from '@/features/accounts/AccountDetails';
import { accountDate, invoiceAmount } from '@/features/accounts/presentation';

const originalLanguage = i18n.language;
afterEach(async () => {
  await i18n.changeLanguage(originalLanguage);
});

const profileResponse = () => ({
  accounts: [
    {
      auth_index: 'grant-one',
      name: 'claude-one.json',
      provider: 'claude',
      email: 'login@example.test',
      disabled: false,
      profile: {
        status: 'ok',
        source: 'claude_oauth_profile',
        last_checked_at: '2026-10-16T12:00:00Z',
        last_success_at: '2026-10-16T12:00:00Z',
        full_name: 'Login Person',
        display_name: 'Login',
        organization_name: 'Personal',
        plan: 'max',
        subscription_status: 'active',
        subscription_started_at: '2026-08-01T10:00:00Z',
      },
      billing: {
        status: 'ok',
        source: 'gmail_receipt',
        last_checked_at: '2026-10-16T12:01:00Z',
        last_success_at: '2026-10-16T12:01:00Z',
        billing_name: 'Billing Person',
        billing_email: 'billing@example.test',
        period_end: '2026-11-01T10:00:00Z',
        invoices: [],
      },
    },
  ],
});

describe('account overview boundary', () => {
  test('preserves login identity, receipt identity and distinct subscription dates', () => {
    const [account] = parseAccountOverview(profileResponse());

    expect(account).toMatchObject({
      authIndex: 'grant-one',
      email: 'login@example.test',
      profile: {
        fullName: 'Login Person',
        subscriptionStartedAt: '2026-08-01T10:00:00Z',
        lastSuccessAt: '2026-10-16T12:00:00Z',
      },
      billing: {
        billingName: 'Billing Person',
        billingEmail: 'billing@example.test',
        periodEnd: '2026-11-01T10:00:00Z',
        renewalAt: null,
        lastSuccessAt: '2026-10-16T12:01:00Z',
      },
    });
  });

  test('retains unsupported-provider and empty-scan states without inventing profile facts', () => {
    const source = profileResponse().accounts[0];
    const [account] = parseAccountOverview({
      accounts: [
        {
          ...source,
          provider: 'codex',
          profile: { status: 'unavailable', plan: 'unknown', error_code: 'unsupported_provider' },
          billing: { status: 'empty', source: 'gmail_receipt', invoices: [] },
        },
      ],
    });
    expect(account.profile).toMatchObject({
      source: null,
      plan: 'unknown',
      fullName: null,
      subscriptionStartedAt: null,
    });
    expect(account.billing).toMatchObject({
      status: 'empty',
      renewalAt: null,
      periodEnd: null,
      invoices: [],
    });
  });

  test('preserves printed calendar dates without timezone conversion or a guessed renewal', () => {
    const source = profileResponse().accounts[0];
    const [account] = parseAccountOverview({
      accounts: [{ ...source, billing: { ...source.billing, period_end: '2026-11-01' } }],
    });
    expect(account.billing.periodEnd).toBe('2026-11-01');
    expect(account.billing.renewalAt).toBeNull();
    expect(accountDate(account.billing.periodEnd, 'en-US')).toBe('11/1/2026');
  });

  test('keeps a printed invoice date on the same calendar day in Toronto', () => {
    const source = profileResponse().accounts[0];
    const [account] = parseAccountOverview({
      accounts: [
        {
          ...source,
          billing: {
            ...source.billing,
            invoices: [
              {
                invoice_id: 'invoice-calendar-date',
                issued_at: '2026-10-16',
                currency: 'USD',
                amount_minor: 2800,
                source_mailbox: 'receipts@example.test',
                source_message_id: 'message-calendar-date',
                evidence_sha256: 'a'.repeat(64),
              },
            ],
          },
        },
      ],
    });
    expect(account.billing.invoices[0].issuedAt).toBe('2026-10-16');
    const moduleUrl = new URL('../src/features/accounts/presentation.ts', import.meta.url).href;
    // Changing TZ inside Bun also changes later tests' Date formatting after restoration.
    const result = spawnSync(
      process.execPath,
      [
        '--eval',
        `
      import { accountDate } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify({
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        date: accountDate('2026-10-16', 'en-CA'),
      }));
    `,
      ],
      { env: { ...process.env, TZ: 'America/Toronto' }, encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ zone: 'America/Toronto', date: '2026-10-16' });
  });

  test('downloads an invoice through the authenticated account endpoint', async () => {
    const original = apiClient.getRaw;
    const pdf = new Blob(['%PDF-1.7\n'], { type: 'application/pdf' });
    let requested: unknown;
    apiClient.getRaw = async (url, config) => {
      requested = { url, config };
      return {
        data: pdf,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/pdf' },
        config: { headers: new AxiosHeaders() },
      };
    };
    try {
      expect(await accountsApi.downloadInvoice('grant/one', 'invoice#one')).toBe(pdf);
      expect(requested).toEqual({
        url: '/credentials/accounts/invoice',
        config: {
          params: { auth_index: 'grant/one', invoice_id: 'invoice#one' },
          responseType: 'blob',
        },
      });
    } finally {
      apiClient.getRaw = original;
    }
  });

  test('refuses a non-PDF response from the invoice endpoint', async () => {
    const original = apiClient.getRaw;
    apiClient.getRaw = async () => ({
      data: new Blob(['{}'], { type: 'application/json' }),
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: { headers: new AxiosHeaders() },
    });
    try {
      await expect(accountsApi.downloadInvoice('grant-one', 'invoice-one')).rejects.toThrow(
        'Invalid invoice PDF'
      );
    } finally {
      apiClient.getRaw = original;
    }
  });
});

describe('account overview refresh', () => {
  test('retains the last successful snapshot when a later read fails', async () => {
    let fails = false;
    const store = createAccountOverviewStore({
      read: async () => {
        if (fails) throw new Error('Service unavailable');
        return parseAccountOverview(profileResponse());
      },
      revision: () => 1,
      now: () => 1000,
    });

    await store.getState().load();
    fails = true;
    await store.getState().load();

    expect(store.getState()).toMatchObject({
      status: 'error',
      receivedAt: 1000,
      error: 'Service unavailable',
      accounts: [{ authIndex: 'grant-one' }],
    });
  });

  test('drops an old connection response after an account with the same ID is loaded elsewhere', async () => {
    let revision = 1;
    let finish: (accounts: ReturnType<typeof parseAccountOverview>) => void = () => {};
    const oldRead = new Promise<ReturnType<typeof parseAccountOverview>>((resolve) => {
      finish = resolve;
    });
    const current = parseAccountOverview(profileResponse());
    const store = createAccountOverviewStore({
      read: () => (revision === 1 ? oldRead : Promise.resolve(current)),
      revision: () => revision,
      now: () => 2000,
    });
    const previous = store.getState().load();
    revision = 2;
    await store.getState().load();
    finish([]);
    await previous;
    expect(store.getState()).toMatchObject({ revision: 2, accounts: current, status: 'ready' });
  });

  test('shares an in-flight overview read between refresh triggers', async () => {
    let reads = 0;
    let finish: (accounts: ReturnType<typeof parseAccountOverview>) => void = () => {};
    const pending = new Promise<ReturnType<typeof parseAccountOverview>>((resolve) => {
      finish = resolve;
    });
    const store = createAccountOverviewStore({
      read: () => {
        reads += 1;
        return pending;
      },
      revision: () => 1,
      now: () => 2000,
    });
    const first = store.getState().load();
    const second = store.getState().load();
    finish(parseAccountOverview(profileResponse()));
    await Promise.all([first, second]);
    expect(reads).toBe(1);
    expect(store.getState().status).toBe('ready');
  });
});

describe('account overview rendering', () => {
  test('separates login and billing identity without calling a period end a renewal', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(AccountTable, {
        accounts: parseAccountOverview(profileResponse()),
        showEmails: false,
        onSelect: () => {},
      })
    );

    expect(markup).toContain('Login');
    expect(markup).toContain('Billing Person');
    expect(markup).toContain('Billing period ends');
    expect(markup).toContain('Renewal');
    expect(markup).toContain('Not reported');
    expect(markup).not.toContain('login@example.test');
    expect(markup).not.toContain('billing@example.test');
  });

  test('keeps fallback account emails masked and uses each currency minor unit', async () => {
    const raw = profileResponse().accounts[0];
    const [account] = parseAccountOverview({
      accounts: [{ ...raw, profile: { status: 'pending', plan: 'unknown' } }],
    });
    const markup = renderToStaticMarkup(
      createElement(AccountTable, { accounts: [account], showEmails: false, onSelect: () => {} })
    );
    expect(markup).not.toContain('login@example.test');
    expect(invoiceAmount(2800, 'USD', 'en-US')).toBe('$28.00');
    expect(invoiceAmount(2800, 'JPY', 'en-US')).toBe('¥2,800');
  });

  test('shows receipt evidence and downloads by invoice identity without linking the opaque PDF ref', async () => {
    await i18n.changeLanguage('en');
    const response = profileResponse();
    const [account] = parseAccountOverview({
      accounts: response.accounts.map((item) => ({
        ...item,
        billing: {
          ...item.billing,
          invoices: [
            {
              invoice_id: 'invoice/one',
              issued_at: '2026-10-01T10:00:00Z',
              currency: 'USD',
              amount_minor: 2800,
              billing_name: 'Billing Person',
              billing_email: 'billing@example.test',
              period_end: '2026-11-01T10:00:00Z',
              pdf_ref: `sha256:${'a'.repeat(64)}`,
              source_mailbox: 'receipts@example.test',
              source_message_id: 'message-one',
              evidence_sha256: 'a'.repeat(64),
              source_authentication: 'gmail_arc',
            },
          ],
        },
      })),
    });
    const markup = renderToStaticMarkup(
      createElement(AccountDetails, {
        account,
        showEmails: false,
        downloadingInvoiceId: null,
        onDownload: () => {},
      })
    );

    expect(markup).toContain('$28.00');
    expect(markup).toContain('Download PDF');
    expect(markup).toContain('message-one');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('billing@example.test');
    expect(markup).not.toContain('receipts@example.test');
  });
});
