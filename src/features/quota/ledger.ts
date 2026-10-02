/**
 * Quota ledger: per-provider summaries and per-credential rows.
 *
 * The ledger answers "which account should I burn next?". Unused weekly quota
 * is lost at reset, so the account whose weekly window resets soonest goes
 * first; an account whose 5-hour window is nearly full shows a red bar there.
 *
 * Pure, like resetSchedule.ts and quotaTimelineModel.ts: the quota state is
 * read structurally per provider, `nowMs` is passed in, and nothing here reads
 * the store. Consumed directly by tests/quotaLedger.test.ts.
 */

import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from './components/QuotaMeter';
import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { codexPlanLabelKey } from '@/utils/quota/planTier';

/** Ledger row order: soonest weekly reset first, or most remaining weekly quota first. */
export type LedgerSortMode = 'reset' | 'remaining';

export type LedgerStatus = 'idle' | 'loading' | 'success' | 'error';

/** A label as an i18n key with an untranslated fallback. */
export interface LedgerLabel {
  key?: string;
  params?: Record<string, string | number>;
  text: string;
}

export interface LedgerWindow {
  id: string;
  label: LedgerLabel;
  /** Remaining percent, 0..100. Null when the provider reported no usage figure. */
  remaining: number | null;
  /** Next reset in epoch ms. Null when no reset is pending. */
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface LedgerRow {
  entry: QuotaFileEntry;
  key: string;
  status: LedgerStatus;
  /** Set when status is 'error'. */
  error?: string;
  errorStatus?: number;
  plan: LedgerLabel | null;
  /** The provider's headline window first, then the rest in provider order. */
  windows: LedgerWindow[];
  /** This credential's headline window, or null when it does not report one. */
  primary: LedgerWindow | null;
}

/** One window summed across a provider's credentials. */
export interface LedgerWindowTotal {
  id: string;
  label: LedgerLabel;
  /** Sum of remaining percent. Null when no credential reports this window. */
  remainingSum: number | null;
  /** Credentials that report a remaining figure for this window. */
  reporting: number;
  /** Soonest reset still in the future, across credentials. */
  soonestResetMs: number | null;
  periodHours: number | null;
}

export interface LedgerSegment {
  key: string;
  remaining: number | null;
}

export interface LedgerSummary {
  provider: QuotaProviderType;
  credentials: number;
  /** 100 per credential. Credentials that have not loaded still count. */
  capacity: number;
  primary: LedgerWindowTotal | null;
  /** One segment per credential, in row order. */
  segments: LedgerSegment[];
  /** Other windows: weekly or longer first, then shorter ones. */
  secondary: LedgerWindowTotal[];
}

export interface LedgerSection {
  provider: QuotaProviderType;
  rows: LedgerRow[];
  summary: LedgerSummary;
}

export type RemainingLevel = 'high' | 'medium' | 'low' | 'unknown';

const WEEK_HOURS = 24 * 7;

/**
 * Headline window ids per provider, most preferred first. The first id any
 * loaded credential of the provider reports becomes that provider's headline,
 * so every row and the summary card compare the same window.
 */
const PRIMARY_WINDOW_IDS: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-fable', 'seven-day'],
  codex: ['weekly', 'monthly'],
  devin: ['weekly', 'daily'],
  kimi: ['summary', 'monthly'],
  meta: ['weekly', 'window'],
  xai: ['xai-weekly', 'xai-monthly'],
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

export function remainingLevel(remaining: number | null): RemainingLevel {
  if (remaining === null) return 'unknown';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/* ------------------------------------------------------------ extraction */

interface UsedWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

const fromUsedWindows = (windows: readonly UsedWindowLike[] | undefined): LedgerWindow[] =>
  (windows ?? []).map((window, index) => ({
    id: window.id || `window-${index}`,
    label: {
      key: window.labelKey,
      params: window.labelParams,
      text: window.label || window.id || `#${index + 1}`,
    },
    remaining: remainingFromUsed(window.usedPercent),
    resetAtMs: finiteOrNull(window.resetAtMs),
    periodHours: finiteOrNull(window.periodHours),
  }));

/**
 * Every quota window a credential reports, as remaining percent.
 *
 * Providers disagree on what their figure means (percent used, fraction
 * remaining, raw counts), so each is converted on its own terms here.
 */
export function extractLedgerWindows(provider: QuotaProviderType, quota: unknown): LedgerWindow[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    return fromUsedWindows((quota as { windows?: UsedWindowLike[] }).windows);
  }

  if (provider === 'devin') {
    const windows =
      (
        quota as {
          windows?: {
            id: string;
            label?: string;
            remainingPercent: number | null;
            resetAtMs: number | null;
            periodHours: number;
          }[];
        }
      ).windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      label: { key: `devin_quota.${window.id}`, text: window.label || window.id },
      remaining: finiteOrNull(window.remainingPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'kimi') {
    const rows =
      (
        quota as {
          rows?: {
            id: string;
            label?: string;
            labelKey?: string;
            labelParams?: Record<string, string | number>;
            used: number;
            limit: number;
            resetAtMs?: number | null;
            periodHours?: number | null;
          }[];
        }
      ).rows ?? [];
    return rows.map((row) => ({
      id: row.id,
      label: { key: row.labelKey, params: row.labelParams, text: row.label || row.id },
      // Kimi reports raw counts; remaining is derived.
      remaining:
        row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null,
      resetAtMs: finiteOrNull(row.resetAtMs),
      periodHours: finiteOrNull(row.periodHours),
    }));
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            id: string;
            buckets?: {
              id: string;
              label?: string;
              remainingFraction?: number | null;
              resetAtMs?: number | null;
              periodHours?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups.flatMap((group) =>
      (group.buckets ?? []).map((bucket) => {
        // Antigravity reports the fraction REMAINING, not percent used.
        const fraction = finiteOrNull(bucket.remainingFraction);
        return {
          id: `${group.id}:${bucket.id}`,
          label: { text: bucket.label || bucket.id },
          remaining: fraction === null ? null : clampPercent(Math.round(fraction * 100)),
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          periodHours: finiteOrNull(bucket.periodHours),
        };
      })
    );
  }

  if (provider === 'xai') {
    const billing = (
      quota as {
        billing?: {
          periodType?: string;
          usagePercent?: number | null;
          resetAtMs?: number | null;
          periodHours?: number | null;
        } | null;
      }
    ).billing;
    if (!billing) return [];
    const weekly = billing.periodType === 'weekly';
    return [
      {
        id: weekly ? 'xai-weekly' : 'xai-monthly',
        label: weekly
          ? { key: 'xai_quota.weekly_limit', text: 'Weekly limit' }
          : { key: 'xai_quota.monthly_credits', text: 'Monthly credits' },
        remaining: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        periodHours: finiteOrNull(billing.periodHours) ?? (weekly ? WEEK_HOURS : null),
      },
    ];
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: {
            windows?: {
              id: 'window' | 'weekly';
              usedPercent: number | null;
              resetAt?: number;
              durationMinutes?: number;
            }[];
          };
        }
      ).data?.windows ?? [];
    return windows.map((window) => {
      const resetAt = finiteOrNull(window.resetAt);
      const minutes = finiteOrNull(window.durationMinutes);
      return {
        id: window.id,
        label: { key: `meta_quota.${window.id}`, text: window.id },
        remaining: remainingFromUsed(window.usedPercent),
        // Meta's contract states reset instants in Unix seconds.
        resetAtMs: resetAt === null ? null : resetAt * 1000,
        periodHours: window.id === 'weekly' ? WEEK_HOURS : minutes === null ? null : minutes / 60,
      };
    });
  }

  return [];
}

/** Plan label shown under the credential name, when the provider reports one. */
export function resolveLedgerPlan(provider: QuotaProviderType, quota: unknown): LedgerLabel | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  const text = (value: unknown): LedgerLabel | null =>
    typeof value === 'string' && value.trim() ? { text: value.trim() } : null;

  switch (provider) {
    case 'claude': {
      const planType = (quota as { planType?: string | null }).planType;
      return planType ? { key: `claude_quota.${planType}`, text: planType } : null;
    }
    case 'codex': {
      const planType = (quota as { planType?: string | null }).planType;
      if (!planType) return null;
      const key = codexPlanLabelKey(planType);
      return key ? { key, text: planType } : { text: planType };
    }
    case 'xai':
      return text((quota as { billing?: { planLabel?: string } | null }).billing?.planLabel);
    case 'antigravity': {
      const subscription = (
        quota as { subscription?: { tierName?: string | null; plan?: string | null } | null }
      ).subscription;
      return text(subscription?.tierName) ?? text(subscription?.plan);
    }
    case 'devin':
      return text((quota as { plan?: string | null }).plan);
    case 'meta':
      return text((quota as { data?: { planName?: string } }).data?.planName);
    default:
      return null;
  }
}

/* ------------------------------------------------------------- headline */

/**
 * The headline window id for a provider, chosen from every loaded credential.
 *
 * Preferred ids come first. A provider without a preference list (Antigravity
 * reports one bucket per model) falls back to the longest window seen.
 */
export function pickPrimaryWindowId(
  provider: QuotaProviderType,
  windowsPerCredential: readonly (readonly LedgerWindow[])[]
): string | null {
  const seen = new Map<string, LedgerWindow>();
  windowsPerCredential.forEach((windows) =>
    windows.forEach((window) => {
      if (!seen.has(window.id)) seen.set(window.id, window);
    })
  );
  if (seen.size === 0) return null;

  const preferred = PRIMARY_WINDOW_IDS[provider]?.find((id) => seen.has(id));
  if (preferred) return preferred;

  let best: LedgerWindow | null = null;
  for (const window of seen.values()) {
    if (best === null || (window.periodHours ?? 0) > (best.periodHours ?? 0)) best = window;
  }
  return best?.id ?? null;
}

/* ----------------------------------------------------------------- sort */

/**
 * Order rows within one provider.
 *
 * `reset`: the headline window that resets soonest first, since its unused
 * quota is the first to be lost. `remaining`: the most headline quota left
 * first. Rows with no figure (not loaded, failed, no reset pending) sink to the
 * bottom in their incoming order; the incoming index is the final tiebreak.
 *
 * A reset at or before `nowMs` counts as no reset. Quotas are cached for the
 * session, so a page left open past a reset still holds the old figure; that
 * row must not lead the list.
 */
export function sortLedgerRows(
  rows: readonly LedgerRow[],
  mode: LedgerSortMode,
  nowMs: number
): LedgerRow[] {
  const upcomingReset = (row: LedgerRow): number | null => {
    const resetAtMs = row.primary?.resetAtMs ?? null;
    return resetAtMs !== null && resetAtMs > nowMs ? resetAtMs : null;
  };
  const keyOf = (row: LedgerRow): number | null =>
    mode === 'reset' ? upcomingReset(row) : (row.primary?.remaining ?? null);

  return rows
    .map((row, index) => ({ row, index, key: keyOf(row) }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const byKey = mode === 'reset' ? a.key - b.key : b.key - a.key;
      return byKey || a.index - b.index;
    })
    .map((decorated) => decorated.row);
}

/* -------------------------------------------------------------- summary */

const totalFor = (
  id: string,
  rows: readonly LedgerRow[],
  nowMs: number
): LedgerWindowTotal | null => {
  let label: LedgerLabel | null = null;
  let periodHours: number | null = null;
  let remainingSum: number | null = null;
  let reporting = 0;
  let soonestResetMs: number | null = null;

  for (const row of rows) {
    const window = row.windows.find((candidate) => candidate.id === id);
    if (!window) continue;
    if (label === null) label = window.label;
    if (periodHours === null) periodHours = window.periodHours;
    if (window.remaining !== null) {
      remainingSum = (remainingSum ?? 0) + window.remaining;
      reporting += 1;
    }
    if (
      window.resetAtMs !== null &&
      window.resetAtMs > nowMs &&
      (soonestResetMs === null || window.resetAtMs < soonestResetMs)
    ) {
      soonestResetMs = window.resetAtMs;
    }
  }

  return label ? { id, label, remainingSum, reporting, soonestResetMs, periodHours } : null;
};

/**
 * Sum one provider's credentials into its summary card.
 *
 * The headline reads as "409% of 500%": remaining percent summed across
 * credentials over 100 per credential. A credential that has not loaded adds
 * nothing to the sum but still counts toward the ceiling, so the gap between
 * the two numbers never hides an account.
 */
export function summarizeLedger(
  provider: QuotaProviderType,
  rows: readonly LedgerRow[],
  primaryId: string | null,
  nowMs: number
): LedgerSummary {
  const ids: string[] = [];
  rows.forEach((row) =>
    row.windows.forEach((window) => {
      if (window.id !== primaryId && !ids.includes(window.id)) ids.push(window.id);
    })
  );

  const secondary = ids
    .map((id) => totalFor(id, rows, nowMs))
    .filter((total): total is LedgerWindowTotal => total !== null)
    .map((total, index) => ({ total, index }))
    .sort((a, b) => {
      const aWeekly = (a.total.periodHours ?? 0) >= WEEK_HOURS ? 0 : 1;
      const bWeekly = (b.total.periodHours ?? 0) >= WEEK_HOURS ? 0 : 1;
      return aWeekly - bWeekly || a.index - b.index;
    })
    .map(({ total }) => total);

  return {
    provider,
    credentials: rows.length,
    capacity: rows.length * 100,
    primary: primaryId === null ? null : totalFor(primaryId, rows, nowMs),
    segments: rows.map((row) => ({ key: row.key, remaining: row.primary?.remaining ?? null })),
    secondary,
  };
}

/* ------------------------------------------------------------- sections */

/**
 * Group entries by provider (keeping the incoming provider order), build each
 * credential's row, pick the provider's headline window, sort, and summarize.
 */
export interface LedgerQuotaState {
  status?: string;
  error?: string;
  errorStatus?: number;
}

export function buildLedgerSections(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => LedgerQuotaState | undefined,
  sortMode: LedgerSortMode,
  nowMs: number
): LedgerSection[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
  entries.forEach((entry) => {
    const group = groups.get(entry.type) ?? [];
    group.push(entry);
    groups.set(entry.type, group);
  });

  return Array.from(groups.entries()).map(([provider, group]) => {
    const loaded = group.map((entry) => {
      const quota = quotaFor(entry);
      const status = (quota?.status ?? 'idle') as LedgerStatus;
      return {
        entry,
        quota,
        status,
        windows: extractLedgerWindows(provider, quota),
      };
    });

    const primaryId = pickPrimaryWindowId(
      provider,
      loaded.map((item) => item.windows)
    );

    const rows: LedgerRow[] = loaded.map(({ entry, quota, status, windows }) => {
      const primary = windows.find((window) => window.id === primaryId) ?? null;
      return {
        entry,
        key: getQuotaCacheKey(entry.file),
        status,
        error: quota?.error,
        errorStatus: quota?.errorStatus,
        plan: resolveLedgerPlan(provider, quota),
        windows: primary ? [primary, ...windows.filter((window) => window !== primary)] : windows,
        primary,
      };
    });

    const sorted = sortLedgerRows(rows, sortMode, nowMs);
    return {
      provider,
      rows: sorted,
      summary: summarizeLedger(provider, sorted, primaryId, nowMs),
    };
  });
}
