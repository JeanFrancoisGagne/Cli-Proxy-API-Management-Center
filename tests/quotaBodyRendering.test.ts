/**
 * Provider bodies rendered end-to-end.
 *
 * Bodies receive their class map as a prop and import no stylesheet, so unlike
 * QuotaCard they can be rendered directly here — which is the only place the
 * "absolute plus countdown" pairing is checked as actual markup rather than as
 * a formatter's return value.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { KimiQuotaBody } from '@/features/quota/providers/kimi/KimiQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { formatInstantShort } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { ClaudeQuotaState, CodexQuotaState, KimiQuotaState } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

/**
 * useNow() freezes to module-load time under renderToStaticMarkup (it reads
 * getServerSnapshot), so instants are placed relative to the real clock.
 */
const now = Date.now();

// The i18n fallback is zh-CN; pin English so the countdown assertions read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('CodexQuotaBody', () => {
  const quota: CodexQuotaState = {
    status: 'success',
    planType: 'pro',
    windows: [
      {
        id: 'primary',
        label: '5-hour limit',
        usedPercent: 38,
        resetLabel: '08-02 18:00',
        resetAtMs: now + 3 * HOUR_MS,
        periodHours: 5,
      },
    ],
    rateLimitResetCredits: [
      {
        id: 'credit-1',
        status: 'available',
        grantedAt: new Date(now - DAY_MS).toISOString(),
        expiresAt: new Date(now + 11 * DAY_MS).toISOString(),
      },
    ],
    rateLimitResetCreditsAvailableCount: 1,
  };

  test.each(['en', 'zh-CN', 'zh-TW', 'ru'])(
    'renders Business Premium with its premium badge in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      try {
        for (const planType of ['self_serve_business_prolite', '  SELF_SERVE_BUSINESS_PROLITE  ']) {
          const markup = renderToStaticMarkup(
            createElement(CodexQuotaBody, { quota: { ...quota, planType }, classes })
          );
          expect(markup).toContain('<span class="premiumPlanValue">Business Premium</span>');
          expect(markup).not.toContain('self_serve_business_prolite');
        }
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );

  test.each([
    ['pro', 'Pro 20x', 'elitePlanValue'],
    ['prolite', 'Pro 5x', 'premiumPlanValue'],
    ['team', 'Team', 'codexPlanValue'],
    ['self_serve_business_usage_based', 'self_serve_business_usage_based', 'codexPlanValue'],
  ])('preserves the label and badge for %s', (planType, label, className) => {
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: { ...quota, planType }, classes })
    );
    expect(markup).toContain(`<span class="${className}">${label}</span>`);
  });

  test.each([
    ['en', 'Credit balance', 'Unlimited'],
    ['zh-CN', 'Credit 余额', '无限额'],
    ['zh-TW', 'Credit 餘額', '無限額'],
    ['ru', 'Остаток кредитов', 'Без ограничений'],
  ])(
    'renders account credits independently of manual resets in %s',
    async (language, label, unlimited) => {
      await i18n.changeLanguage(language);
      try {
        const balance = renderToStaticMarkup(
          createElement(CodexQuotaBody, { quota: { ...quota, creditBalance: '0' }, classes })
        );
        expect(balance).toContain(label);
        expect(balance).toContain('<span class="codexPlanValue">0</span>');
        const infinite = renderToStaticMarkup(
          createElement(CodexQuotaBody, {
            quota: { ...quota, creditBalance: null, creditsUnlimited: true },
            classes,
          })
        );
        expect(infinite).toContain(label);
        expect(infinite).toContain(unlimited);
        const absent = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));
        expect(absent).not.toContain(label);
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );

  test('renders a window reset as absolute plus countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).toContain('quotaResetRelative');
    expect(markup).toMatch(/3 hours/);
  });

  test('renders reset-credit expiry in local time with a countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain(formatInstantShort(now + 11 * DAY_MS));
    expect(markup).toMatch(/11 days/);
  });

  test('highlights a credit expiring within the final hour', () => {
    const creditFirst: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now + 5 * DAY_MS }],
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: new Date(now - DAY_MS).toISOString(),
          expiresAt: new Date(now + 30 * 60_000).toISOString(),
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: creditFirst, classes })
    );

    expect(markup).toContain('codexResetCreditRowSoon');
    expect(markup).not.toContain('quotaRowSoon');
  });

  test('does not emphasize a reset countdown more than one hour away', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).not.toContain('quotaRowSoon');
    expect(markup).not.toContain('quotaResetRelativeSoon');
    expect(markup).not.toContain('codexResetCreditRowSoon');
  });

  test('emphasizes a reset countdown within the final hour', () => {
    const urgent: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now + 30 * 60_000 }],
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: urgent, classes }));

    expect(markup).toContain('quotaResetRelativeSoon');
  });

  test('highlights nothing once every instant is in the past', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now - HOUR_MS }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).not.toContain('Soon');
  });

  test('keeps the baked label alone when the store entry predates resetAtMs', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: undefined, periodHours: undefined }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).not.toContain('quotaResetRelative');
  });
});

describe('KimiQuotaBody', () => {
  test('renders the concrete reset time alongside its countdown', () => {
    const resetAtMs = now + 3 * HOUR_MS;
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        {
          id: 'summary',
          label: 'Weekly limit',
          used: 34,
          limit: 100,
          resetHint: '3h',
          resetAtMs,
          periodHours: 168,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(KimiQuotaBody, { quota, classes }));

    expect(markup).toContain(formatInstantShort(resetAtMs));
    expect(markup).toContain('quotaResetRelative');
    expect(markup).toMatch(/3 hours/);
    expect(markup).not.toContain('resets in 3h');
  });
});

describe('ClaudeQuotaBody', () => {
  for (const sessionUsed of [0, 100]) {
    test(`includes the scoped model blocker when shared session usage is ${sessionUsed}%`, () => {
      const quota: ClaudeQuotaState = {
        status: 'success',
        windows: [
          {
            id: 'five-hour',
            label: '5-hour',
            usedPercent: sessionUsed,
            resetLabel: '-',
            resetAtMs: now + HOUR_MS,
          },
          {
            id: 'seven-day',
            label: '7-day',
            usedPercent: 20,
            resetLabel: '-',
            resetAtMs: now + 4 * DAY_MS,
          },
          {
            id: 'seven-day-fable',
            label: 'Fable',
            usedPercent: 100,
            resetLabel: '-',
            resetAtMs: now + 2 * DAY_MS,
          },
        ],
      };
      const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));
      const weeklyRow = markup.indexOf('<span class="quotaModel">7-day</span>');
      const sessionRow = markup.indexOf('<span class="quotaModel">5-hour</span>');
      const modelRow = markup.indexOf('<span class="quotaModel">Fable</span>');
      expect(weeklyRow).toBeLessThan(sessionRow);
      expect(sessionRow).toBeLessThan(modelRow);
      if (sessionUsed === 0) {
        expect(markup.slice(0, weeklyRow)).not.toContain('Included quota blocked');
      }
      expect(markup).toContain(
        `Included quota blocked: ${sessionUsed === 100 ? '5-hour, ' : ''}Fable`
      );
      expect(markup).toMatch(/Next blocking reset: [^<]*2 days/);
    });
  }

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    test(`shows the shared blocker beside remaining model allowance in ${locale}`, async () => {
      await i18n.changeLanguage(locale);
      const quota: ClaudeQuotaState = {
        status: 'success',
        windows: [
          {
            id: 'five-hour',
            label: '5-hour limit',
            labelKey: 'claude_quota.five_hour',
            usedPercent: 100,
            resetLabel: '-',
            resetAtMs: now + 2 * HOUR_MS,
          },
          {
            id: 'seven-day',
            label: '7-day limit',
            labelKey: 'claude_quota.seven_day',
            usedPercent: 51,
            resetLabel: '-',
            resetAtMs: now + 4 * DAY_MS,
          },
          {
            id: 'seven-day-fable',
            label: 'Fable',
            usedPercent: 0,
            resetLabel: '-',
            resetAtMs: now + 4 * DAY_MS,
          },
        ],
        extraUsage: { is_enabled: true, monthly_limit: 1000, used_credits: 100, utilization: 10 },
      };
      const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));
      expect(markup).toContain(
        i18n.t('claude_quota.included_blocked', { windows: i18n.t('claude_quota.five_hour') })
      );
      expect(markup).toContain(formatInstantShort(now + 2 * HOUR_MS));
      expect(markup).toContain('100%');
      expect(markup).toContain('$1.00 / $10.00');
      expect(markup).not.toContain('claude_quota.included_');
      await i18n.changeLanguage('en');
    });
  }

  test('requires a refresh after a cached shared reset passes', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour',
          usedPercent: 100,
          resetLabel: '-',
          resetAtMs: now - HOUR_MS,
        },
        {
          id: 'seven-day',
          label: '7-day',
          usedPercent: 20,
          resetLabel: '-',
          resetAtMs: now + DAY_MS,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));
    expect(markup).toContain('Availability unknown. Refresh quota.');
    expect(markup).not.toContain('Included quota blocked');
  });

  test('pairs each window reset with a countdown', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'five_hour',
          label: '5-hour',
          usedPercent: 12,
          resetLabel: '08-02 17:00',
          resetAtMs: now + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'seven_day',
          label: '7-day',
          usedPercent: 60,
          resetLabel: '08-06 04:00',
          resetAtMs: now + 4 * DAY_MS,
          periodHours: 168,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 17:00');
    expect(markup).toContain('08-06 04:00');
    expect(markup).toMatch(/2 hours/);
    expect(markup).toMatch(/4 days/);
  });
});
