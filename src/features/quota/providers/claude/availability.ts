import type { ClaudeQuotaWindow } from '@/types';

export const CLAUDE_PRIMARY_WINDOW_IDS = ['seven-day', 'five-hour'] as const;

/** Shared account limits lead; model allowances keep their incoming order afterward. */
export function orderClaudeWindows<T extends { id: string }>(windows: readonly T[]): T[] {
  const priority = (id: string) => {
    const index = CLAUDE_PRIMARY_WINDOW_IDS.findIndex((candidate) => candidate === id);
    return index < 0 ? CLAUDE_PRIMARY_WINDOW_IDS.length : index;
  };
  return [...windows].sort((a, b) => priority(a.id) - priority(b.id));
}

export type ClaudeAvailability =
  | { status: 'available' }
  | { status: 'unknown' }
  | { status: 'blocked'; windowIds: string[]; resetAtMs: number | null };

export interface ClaudeAvailabilitySummary {
  available: number;
  blocked: number;
  unknown: number;
  nextResetAtMs: number | null;
  segments: { key: string; remaining: 0 | 100 | null }[];
}

export function summarizeClaudeAvailability(
  rows: readonly { key: string; availability: ClaudeAvailability | null }[]
): ClaudeAvailabilitySummary {
  const summary: ClaudeAvailabilitySummary = {
    available: 0,
    blocked: 0,
    unknown: 0,
    nextResetAtMs: null,
    segments: [],
  };
  for (const row of rows) {
    const state: ClaudeAvailability = row.availability ?? { status: 'unknown' };
    summary[state.status] += 1;
    summary.segments.push({
      key: row.key,
      remaining: state.status === 'available' ? 100 : state.status === 'blocked' ? 0 : null,
    });
    if (
      state.status === 'blocked' &&
      state.resetAtMs !== null &&
      (summary.nextResetAtMs === null || state.resetAtMs < summary.nextResetAtMs)
    ) {
      summary.nextResetAtMs = state.resetAtMs;
    }
  }
  return summary;
}

interface AllowanceWindow {
  id: string;
  remaining: number | null;
  resetAtMs: number | null;
}

/** Included allowance only. Paid extra usage and proxy credential health are separate. */
export function getClaudeAvailability(
  windows: readonly AllowanceWindow[],
  nowMs: number,
  modelWindowId?: string | null
): ClaudeAvailability {
  const requiredIds = ['five-hour', 'seven-day'];
  if (modelWindowId && !requiredIds.includes(modelWindowId)) requiredIds.push(modelWindowId);
  const blockers: AllowanceWindow[] = [];
  let unknown = false;

  for (const id of requiredIds) {
    const window = windows.find((candidate) => candidate.id === id);
    // A passed reset invalidates the cached figure. A clock tick cannot prove
    // that the provider reset the allowance; only a fresh usage response can.
    if (
      !window ||
      window.remaining === null ||
      !Number.isFinite(window.remaining) ||
      (window.resetAtMs !== null && window.resetAtMs <= nowMs)
    ) {
      unknown = true;
    } else if (window.remaining <= 0) {
      blockers.push(window);
    }
  }

  if (blockers.length > 0) {
    const resets = blockers.map((window) => window.resetAtMs);
    return {
      status: 'blocked',
      windowIds: blockers.map((window) => window.id),
      // Every exhausted window must reset. Missing or stale observations must
      // not produce a time that promises the account will be usable.
      resetAtMs:
        unknown || resets.some((reset) => reset === null)
          ? null
          : Math.max(...resets.filter((reset) => reset !== null)),
    };
  }
  return { status: unknown ? 'unknown' : 'available' };
}

export function getClaudeQuotaAvailability(
  windows: readonly ClaudeQuotaWindow[],
  nowMs: number,
  modelWindowId?: string
): ClaudeAvailability {
  return getClaudeAvailability(
    windows.map((window) => ({
      id: window.id,
      remaining:
        window.usedPercent !== null && Number.isFinite(window.usedPercent)
          ? Math.max(0, Math.min(100, 100 - window.usedPercent))
          : null,
      resetAtMs: window.resetAtMs ?? null,
    })),
    nowMs,
    modelWindowId ??
      CLAUDE_PRIMARY_WINDOW_IDS.find((id) => windows.some((window) => window.id === id))
  );
}
