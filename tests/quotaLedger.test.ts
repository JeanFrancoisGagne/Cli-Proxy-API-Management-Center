/**
 * Quota ledger: window extraction, the per-provider headline, the summary
 * math behind "409% of 500%", and the two row orders.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaLedger } from '@/features/quota/components/QuotaLedger';
import {
  buildLedgerSections,
  extractLedgerWindows,
  pickPrimaryWindowId,
  remainingLevel,
  resolveLedgerPlan,
  sortLedgerRows,
  summarizeLedger,
  type LedgerRow,
  type LedgerWindow,
} from '@/features/quota/ledger';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { AuthFileItem, ClaudeQuotaWindow } from '@/types';

const NOW = Date.UTC(2026, 8, 11, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const entry = (name: string, type: QuotaFileEntry['type'], email?: string): QuotaFileEntry => ({
  file: { name, type, email } as AuthFileItem,
  type,
});

/** Claude state shaped like buildClaudeQuotaWindows output (percent USED). */
const claudeQuota = (
  fableUsed: number,
  sevenDayUsed: number,
  fiveHourUsed: number,
  resetInDays: number
) => {
  const windows: ClaudeQuotaWindow[] = [
    {
      id: 'five-hour',
      label: '5-hour limit',
      labelKey: 'claude_quota.five_hour',
      usedPercent: fiveHourUsed,
      resetLabel: '-',
      resetAtMs: fiveHourUsed > 0 ? NOW + 3 * HOUR : null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: sevenDayUsed,
      resetLabel: '-',
      resetAtMs: NOW + resetInDays * DAY,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: '7-day Fable 5',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: fableUsed,
      resetLabel: '-',
      resetAtMs: NOW + resetInDays * DAY,
      periodHours: 168,
    },
  ];
  return { status: 'success', windows, planType: 'plan_max' };
};

/** The five Claude accounts from the screenshot: 409% of 500% Fable, 454% 7-day. */
const CLAUDE_ENTRIES = [
  entry('claude-a@one.dev.json', 'claude'),
  entry('claude-b@two.gg.json', 'claude'),
  entry('claude-c@three.gg.json', 'claude'),
  entry('claude-d@four.gg.json', 'claude'),
  entry('claude-e@five.gg.json', 'claude'),
];
const CLAUDE_STATES: Record<string, ReturnType<typeof claudeQuota>> = {
  'claude-a@one.dev.json': claudeQuota(42, 21, 0, 2),
  'claude-b@two.gg.json': claudeQuota(0, 0, 0, 4),
  'claude-c@three.gg.json': claudeQuota(0, 0, 0, 5),
  'claude-d@four.gg.json': claudeQuota(49, 25, 1, 1),
  'claude-e@five.gg.json': claudeQuota(0, 0, 0, 6),
};

const quotaFor = (states: Record<string, unknown>) => (target: QuotaFileEntry) =>
  states[target.file.name] as { status?: string } | undefined;

const window = (id: string, remaining: number | null, resetAtMs: number | null): LedgerWindow => ({
  id,
  label: { text: id },
  remaining,
  resetAtMs,
  periodHours: 168,
});

const row = (name: string, primary: LedgerWindow | null): LedgerRow => ({
  entry: entry(name, 'claude'),
  key: name,
  status: primary ? 'success' : 'idle',
  plan: null,
  windows: primary ? [primary] : [],
  primary,
  availability: null,
});

describe('extractLedgerWindows', () => {
  test('converts percent used into percent remaining', () => {
    const windows = extractLedgerWindows('claude', claudeQuota(42, 21, 0, 2));
    expect(windows.map((w) => [w.id, w.remaining])).toEqual([
      ['seven-day', 79],
      ['five-hour', 100],
      ['seven-day-fable', 58],
    ]);
    expect(windows.find((window) => window.id === 'five-hour')?.resetAtMs).toBeNull();
  });

  test('reads Kimi counts, Antigravity fractions, and Meta seconds', () => {
    const kimi = extractLedgerWindows('kimi', {
      status: 'success',
      rows: [{ id: 'summary', labelKey: 'kimi_quota.weekly_limit', used: 25, limit: 100 }],
    });
    expect(kimi[0]).toMatchObject({ id: 'summary', remaining: 75 });

    const antigravity = extractLedgerWindows('antigravity', {
      status: 'success',
      groups: [{ id: 'g', buckets: [{ id: 'b', label: 'Gemini', remainingFraction: 0.4 }] }],
    });
    expect(antigravity[0]).toMatchObject({ id: 'g:b', remaining: 40 });

    const meta = extractLedgerWindows('meta', {
      status: 'success',
      data: { windows: [{ id: 'weekly', usedPercent: 10, resetAt: 1_800_000_000 }] },
    });
    expect(meta[0]).toMatchObject({
      remaining: 90,
      resetAtMs: 1_800_000_000_000,
      periodHours: 168,
    });
  });

  test('labels the xAI billing period it reports', () => {
    const weekly = extractLedgerWindows('xai', {
      status: 'success',
      billing: { periodType: 'weekly', usagePercent: 30, resetAtMs: NOW + DAY },
    });
    expect(weekly[0]).toMatchObject({ id: 'xai-weekly', remaining: 70, periodHours: 168 });

    const monthly = extractLedgerWindows('xai', {
      status: 'success',
      billing: { periodType: 'monthly', usagePercent: null },
    });
    expect(monthly[0]).toMatchObject({ id: 'xai-monthly', remaining: null });
  });

  test('returns nothing for credentials that have not loaded', () => {
    expect(extractLedgerWindows('claude', undefined)).toEqual([]);
    expect(extractLedgerWindows('claude', { status: 'loading', windows: [] })).toEqual([]);
    expect(extractLedgerWindows('codex', { status: 'error', windows: [] })).toEqual([]);
  });
});

describe('pickPrimaryWindowId', () => {
  test('prefers the all-model weekly limit, then session, before scoped model limits', () => {
    const fable = [window('five-hour', 100, null), window('seven-day-fable', 50, 1)];
    const general = [window('five-hour', 100, null), window('seven-day', 50, 1)];
    expect(pickPrimaryWindowId('claude', [general, fable])).toBe('seven-day');
    expect(pickPrimaryWindowId('claude', [general])).toBe('seven-day');
    expect(pickPrimaryWindowId('claude', [fable])).toBe('five-hour');
    expect(pickPrimaryWindowId('claude', [])).toBeNull();
  });

  test('falls back to the longest window for providers without a preference', () => {
    const buckets = [
      { ...window('g:short', 80, 1), periodHours: 5 },
      { ...window('g:long', 20, 1), periodHours: 168 },
    ];
    expect(pickPrimaryWindowId('antigravity', [buckets])).toBe('g:long');
  });
});

describe('summary math', () => {
  test('reports zero usable Claude accounts when shared limits block remaining Fable allowance', () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      entry(`account-${index}.json`, 'claude')
    );
    const states = Object.fromEntries(
      entries.map((item, index) => [
        item.file.name,
        claudeQuota(
          index === 1 ? 4 : index === 5 ? 2 : 0,
          index === 0 ? 51 : 100,
          index === 0 ? 100 : 0,
          index + 1
        ),
      ])
    );
    const [section] = buildLedgerSections(entries, quotaFor(states), 'reset', NOW);
    expect(section.summary.primary).toMatchObject({ id: 'seven-day', remainingSum: 49 });
    expect(
      section.summary.secondary.find((window) => window.id === 'seven-day-fable')?.remainingSum
    ).toBe(894);
    expect(section.summary.availability).toMatchObject({
      available: 0,
      blocked: 9,
      unknown: 0,
      nextResetAtMs: NOW + 3 * HOUR,
    });
    expect(section.rows[0].availability).toEqual({
      status: 'blocked',
      windowIds: ['five-hour'],
      resetAtMs: NOW + 3 * HOUR,
    });
    expect(section.summary.availability?.segments.every((segment) => segment.remaining === 0)).toBe(
      true
    );
  });

  test('counts overall shared capacity separately from model-specific exhaustion', () => {
    const states = {
      ready: claudeQuota(5, 20, 0, 2),
      modelBlocked: claudeQuota(100, 20, 0, 2),
      bothBlocked: claudeQuota(0, 100, 100, 2),
      stale: claudeQuota(0, 0, 0, -1),
      missing: { ...claudeQuota(0, 0, 0, 2), windows: [] },
      loading: { status: 'loading', windows: [] },
    };
    const entries = Object.keys(states).map((name) => entry(name, 'claude'));
    const [section] = buildLedgerSections(entries, quotaFor(states), 'remaining', NOW);
    expect(section.summary.availability).toMatchObject({
      available: 2,
      blocked: 1,
      unknown: 3,
      nextResetAtMs: NOW + 2 * DAY,
    });
    expect(section.rows.find((item) => item.key === 'bothBlocked')?.availability).toEqual({
      status: 'blocked',
      windowIds: ['five-hour', 'seven-day'],
      resetAtMs: NOW + 2 * DAY,
    });
    expect(section.rows.find((item) => item.key === 'modelBlocked')?.availability).toMatchObject({
      status: 'available',
    });
    expect(section.rows.find((item) => item.key === 'stale')?.availability).toEqual({
      status: 'unknown',
    });
  });

  test('does not invent a recovery time for a blocker without a reset', () => {
    const quota = claudeQuota(0, 100, 0, 1);
    quota.windows[1].resetAtMs = null;
    const [section] = buildLedgerSections(
      [entry('blocked', 'claude')],
      quotaFor({ blocked: quota }),
      'reset',
      NOW
    );
    expect(section.rows[0].availability).toEqual({
      status: 'blocked',
      windowIds: ['seven-day'],
      resetAtMs: null,
    });
    expect(section.summary.availability?.nextResetAtMs).toBeNull();
  });

  test('sums remaining percent over 100 per credential', () => {
    const [section] = buildLedgerSections(CLAUDE_ENTRIES, quotaFor(CLAUDE_STATES), 'reset', NOW);
    expect(section.summary.capacity).toBe(500);
    expect(section.summary.primary).toMatchObject({
      id: 'seven-day',
      remainingSum: 454,
      reporting: 5,
      soonestResetMs: NOW + 1 * DAY,
    });
    expect(section.summary.secondary[1]).toMatchObject({
      id: 'seven-day-fable',
      remainingSum: 409,
    });
  });

  test('lists the shared session before secondary scoped model windows', () => {
    const [section] = buildLedgerSections(CLAUDE_ENTRIES, quotaFor(CLAUDE_STATES), 'reset', NOW);
    expect(section.summary.secondary.map((total) => total.id)).toEqual([
      'five-hour',
      'seven-day-fable',
    ]);
  });

  test('unloaded credentials count toward the ceiling but not the sum', () => {
    const rows = [row('a', window('weekly', 17, NOW + DAY)), row('b', null), row('c', null)];
    const summary = summarizeLedger('codex', rows, 'weekly', NOW);
    expect(summary.capacity).toBe(300);
    expect(summary.primary).toMatchObject({ remainingSum: 17, reporting: 1 });
    expect(summary.segments.map((segment) => segment.remaining)).toEqual([17, null, null]);
  });

  test('reports no figure when nothing has loaded', () => {
    const summary = summarizeLedger('xai', [row('a', null)], null, NOW);
    expect(summary.primary).toBeNull();
    expect(summary.capacity).toBe(100);
  });

  test('ignores resets that already passed when picking the soonest', () => {
    const rows = [
      row('a', window('weekly', 50, NOW - HOUR)),
      row('b', window('weekly', 50, NOW + 2 * DAY)),
    ];
    expect(summarizeLedger('codex', rows, 'weekly', NOW).primary?.soonestResetMs).toBe(
      NOW + 2 * DAY
    );
  });
});

describe('sortLedgerRows', () => {
  const rows = [
    row('late', window('weekly', 90, NOW + 5 * DAY)),
    row('unloaded', null),
    row('soon', window('weekly', 30, NOW + DAY)),
    row('no-reset', window('weekly', 100, null)),
    row('mid', window('weekly', 60, NOW + 3 * DAY)),
  ];

  test('reset: soonest weekly reset first, rows without one at the bottom in order', () => {
    expect(sortLedgerRows(rows, 'reset', NOW).map((r) => r.key)).toEqual([
      'soon',
      'mid',
      'late',
      'unloaded',
      'no-reset',
    ]);
  });

  test('remaining: most remaining first, unloaded last', () => {
    expect(sortLedgerRows(rows, 'remaining', NOW).map((r) => r.key)).toEqual([
      'no-reset',
      'late',
      'mid',
      'soon',
      'unloaded',
    ]);
  });

  test('reset: a reset that already passed sinks with the rows that have none', () => {
    const withPast = [
      row('passed', window('weekly', 0, NOW - DAY)),
      row('soon', window('weekly', 30, NOW + DAY)),
      row('unloaded', null),
      row('at-now', window('weekly', 10, NOW)),
      row('late', window('weekly', 90, NOW + 4 * DAY)),
    ];
    expect(sortLedgerRows(withPast, 'reset', NOW).map((r) => r.key)).toEqual([
      'soon',
      'late',
      'passed',
      'unloaded',
      'at-now',
    ]);
  });

  test('ties keep the incoming order', () => {
    const tied = [
      row('x', window('weekly', 50, NOW + DAY)),
      row('y', window('weekly', 50, NOW + DAY)),
    ];
    expect(sortLedgerRows(tied, 'reset', NOW).map((r) => r.key)).toEqual(['x', 'y']);
    expect(sortLedgerRows(tied, 'remaining', NOW).map((r) => r.key)).toEqual(['x', 'y']);
  });

  test('sections sort rows and put the headline window first in each row', () => {
    const [section] = buildLedgerSections(CLAUDE_ENTRIES, quotaFor(CLAUDE_STATES), 'reset', NOW);
    expect(section.rows.map((r) => r.key)).toEqual([
      'claude-d@four.gg.json',
      'claude-a@one.dev.json',
      'claude-b@two.gg.json',
      'claude-c@three.gg.json',
      'claude-e@five.gg.json',
    ]);
    expect(section.rows[0].windows.map((w) => w.id)).toEqual([
      'seven-day',
      'five-hour',
      'seven-day-fable',
    ]);
  });
  test('a cached figure whose weekly reset passed does not lead its section', () => {
    const entries = [
      entry('claude-a@one.dev.json', 'claude'),
      entry('claude-b@two.gg.json', 'claude'),
      entry('claude-c@three.gg.json', 'claude'),
    ];
    const states = {
      'claude-a@one.dev.json': claudeQuota(42, 21, 0, 1),
      'claude-b@two.gg.json': claudeQuota(10, 5, 0, 4),
      'claude-c@three.gg.json': claudeQuota(100, 100, 0, -1),
    };
    const [section] = buildLedgerSections(entries, quotaFor(states), 'reset', NOW);
    expect(section.rows.map((r) => r.key)).toEqual([
      'claude-a@one.dev.json',
      'claude-b@two.gg.json',
      'claude-c@three.gg.json',
    ]);
    expect(section.summary.primary?.soonestResetMs).toBe(NOW + DAY);
  });
});

describe('sections and helpers', () => {
  test('groups entries by provider in incoming order', () => {
    const entries = [
      entry('claude-1.json', 'claude'),
      entry('codex-1.json', 'codex'),
      entry('claude-2.json', 'claude'),
    ];
    const sections = buildLedgerSections(entries, () => undefined, 'reset', NOW);
    expect(sections.map((section) => [section.provider, section.rows.length])).toEqual([
      ['claude', 2],
      ['codex', 1],
    ]);
    expect(sections[0].rows[0].status).toBe('idle');
  });

  test('remaining levels share the quota meter thresholds', () => {
    expect(remainingLevel(70)).toBe('high');
    expect(remainingLevel(69)).toBe('medium');
    expect(remainingLevel(30)).toBe('medium');
    expect(remainingLevel(29)).toBe('low');
    expect(remainingLevel(null)).toBe('unknown');
  });

  test('plan labels resolve per provider', () => {
    expect(resolveLedgerPlan('claude', claudeQuota(0, 0, 0, 1))).toEqual({
      key: 'claude_quota.plan_max',
      text: 'plan_max',
    });
    expect(resolveLedgerPlan('codex', { status: 'success', planType: 'pro' })).toEqual({
      key: 'codex_quota.plan_pro',
      text: 'pro',
    });
    expect(resolveLedgerPlan('codex', { status: 'success', planType: 'enterprise' })).toEqual({
      text: 'enterprise',
    });
    expect(resolveLedgerPlan('kimi', { status: 'success', rows: [] })).toBeNull();
    expect(resolveLedgerPlan('claude', { status: 'idle' })).toBeNull();
  });
});

describe('QuotaLedger rendering', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  test('shows overall weekly and session caps before Fable in the overview and account row', () => {
    const [section] = buildLedgerSections(
      [entry('overall.json', 'claude')],
      quotaFor({ 'overall.json': claudeQuota(100, 20, 0, 1) }),
      'reset',
      NOW
    );
    expect(section.rows[0].windows.map((window) => window.id)).toEqual([
      'seven-day',
      'five-hour',
      'seven-day-fable',
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        entries: [entry('overall.json', 'claude')],
        quotaFor: quotaFor({ 'overall.json': claudeQuota(100, 20, 0, 1) }) as never,
        sortMode: 'reset',
        nameFor: (file: AuthFileItem) => file.name,
        resolvedTheme: 'dark',
        canRefresh: true,
        onRefresh: () => {},
        now: NOW,
      })
    );
    const overview = markup.slice(0, markup.indexOf('</article>'));
    expect(overview).toContain('Usable accounts · 7-day limit');
    expect(overview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('1 of 1');
    expect(overview).toContain('0 blocked');
    expect(markup).toContain('Included quota blocked: 7-day Fable 5');
    expect(overview.indexOf('5-hour limit')).toBeGreaterThan(overview.indexOf('7-day limit'));
    expect(overview.indexOf('7-day Fable 5')).toBeGreaterThan(overview.indexOf('5-hour limit'));
    expect(overview).not.toContain('aria-expanded');
  });

  test('labels blocked Claude capacity instead of presenting scoped allowance as usable', () => {
    const entries = [entry('blocked.json', 'claude')];
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        entries,
        quotaFor: quotaFor({ 'blocked.json': claudeQuota(0, 100, 0, 1) }) as never,
        sortMode: 'reset',
        nameFor: (file: AuthFileItem) => file.name,
        resolvedTheme: 'dark',
        canRefresh: true,
        onRefresh: () => {},
        now: NOW,
      })
    );
    expect(markup).toContain('Usable accounts');
    expect(markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('0 of 1');
    expect(markup).toContain('1 blocked');
    expect(markup).toContain('Included quota blocked: 7-day limit');
    expect(markup).toContain('Allowance remaining');
    expect(markup).not.toContain('of 100%');
  });

  test('renders the summary figure, masked names, plans and reset lines', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        entries: [...CLAUDE_ENTRIES, entry('codex-x@y.com.json', 'codex')],
        quotaFor: quotaFor(CLAUDE_STATES) as never,
        sortMode: 'reset',
        nameFor: (file: AuthFileItem) => file.name.replace(/@.*\.json$/, '@•••.json'),
        resolvedTheme: 'dark',
        canRefresh: true,
        onRefresh: () => {},
        now: NOW,
      })
    );

    expect(markup).toContain('409%');
    expect(markup).toContain('of 5');
    expect(markup).toContain('Usable accounts');
    expect(markup).toContain('7-day limit');
    expect(markup).toContain('454%');
    expect(markup).toContain('5 credentials');
    expect(markup).toContain('1 credential<');
    expect(markup).toContain('7-day Fable 5');
    expect(markup).toContain('Max');
    expect(markup).toContain('No reset pending');
    expect(markup).toContain('in 1 day');
    expect(markup).toContain('claude-d@•••.json');
    expect(markup).not.toContain('four.gg');
    expect(markup).toContain('Not loaded. Use Refresh quota.');
    expect(markup).toContain('Refresh quota');
  });
});
