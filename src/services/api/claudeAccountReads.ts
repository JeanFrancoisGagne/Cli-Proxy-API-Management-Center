import { apiCallApi, type ApiCallRequest, type ApiCallResult } from './apiCall';
import { apiClient } from './client';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_URL,
} from '@/utils/quota/constants';

const READ_URLS = {
  usage: CLAUDE_USAGE_URL,
  'reset-grants': `${CLAUDE_USAGE_URL}?cedar_ember=1&skip_spend=1`,
  profile: CLAUDE_PROFILE_URL,
} satisfies Record<string, string>;

type ClaudeAccountRead = keyof typeof READ_URLS;
interface ClaudeAccountReadDependencies {
  request: (request: ApiCallRequest) => Promise<ApiCallResult>;
  revision: () => number;
  now: () => number;
  wallNow: () => number;
}

interface ClaudeCredentialObservation {
  authIndex: string;
  lastRefresh: string | null;
}

export class ClaudeAccountReadError extends Error {
  constructor(readonly code: 'missing_auth_index' | 'stale_connection' | 'stale_credential') {
    super(`Claude account read failed (${code})`);
    this.name = 'ClaudeAccountReadError';
  }
}

function headerValue(header: ApiCallResult['header'], name: string): string | undefined {
  return Object.entries(header)
    .find(([key]) => key.toLowerCase() === name)?.[1]?.[0]
    ?.trim();
}

function retryDelay(response: ApiCallResult, wallNow: number): number | null {
  const value = headerValue(response.header, 'retry-after');
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? delay : null;
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  const serverDate = Date.parse(headerValue(response.header, 'date') ?? '');
  return Math.max(0, retryAt - (Number.isFinite(serverDate) ? serverDate : wallNow));
}

/**
 * A quota response with HTTP 429 applies to both usage views. Keep its deadline on a monotonic
 * clock so another card, a failed read, or a wall-clock change cannot shorten it.
 * The proxy owns the same protection across tabs and other machines.
 */
export function createClaudeAccountReader(deps: ClaudeAccountReadDependencies) {
  let revision = deps.revision();
  const inFlight = new Map<string, Promise<ApiCallResult>>();
  const limits = new Map<string, { until: number; response: ApiCallResult }>();
  const credentials = new Map<string, { lastRefresh: string | null }>();

  const syncConnection = () => {
    const currentRevision = deps.revision();
    if (revision !== currentRevision) {
      revision = currentRevision;
      inFlight.clear();
      limits.clear();
      credentials.clear();
    }
    return currentRevision;
  };

  const invalidate = (identity: string) => {
    for (const kind of Object.keys(READ_URLS)) inFlight.delete(JSON.stringify([identity, kind]));
    for (const family of ['usage', 'profile']) limits.delete(JSON.stringify([identity, family]));
  };

  /** Only a complete, current inventory may replace credential generations. */
  const observeCredentials = (observations: readonly ClaudeCredentialObservation[]) => {
    syncConnection();
    const present = new Set<string>();
    for (const { authIndex, lastRefresh } of observations) {
      present.add(authIndex);
      const existing = credentials.get(authIndex);
      // Priority edits change updated_at. Only last_refresh proves new tokens;
      // missing metadata cannot prove replacement and must keep the embargo.
      if (existing && (lastRefresh === null || existing.lastRefresh === lastRefresh)) continue;
      invalidate(authIndex);
      credentials.set(authIndex, { lastRefresh });
    }
    for (const identity of credentials.keys()) {
      if (present.has(identity)) continue;
      invalidate(identity);
      credentials.delete(identity);
    }
  };

  const read = (authIndex: string, kind: ClaudeAccountRead): Promise<ApiCallResult> => {
    const currentRevision = syncConnection();
    const identity = authIndex.trim();
    if (!identity) return Promise.reject(new ClaudeAccountReadError('missing_auth_index'));
    let credential = credentials.get(identity);
    if (!credential) {
      credential = { lastRefresh: null };
      credentials.set(identity, credential);
    }
    const family = kind === 'profile' ? 'profile' : 'usage';
    const limitKey = JSON.stringify([identity, family]);
    const key = JSON.stringify([identity, kind]);
    const limit = limits.get(limitKey);
    if (limit && deps.now() < limit.until) return Promise.resolve(limit.response);
    if (limit) limits.delete(limitKey);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = deps
      .request({
        authIndex: identity,
        method: 'GET',
        url: READ_URLS[kind],
        header: { ...CLAUDE_REQUEST_HEADERS },
      })
      .then((response) => {
        if (deps.revision() !== currentRevision) {
          throw new ClaudeAccountReadError('stale_connection');
        }
        if (credentials.get(identity) !== credential) {
          throw new ClaudeAccountReadError('stale_credential');
        }
        if (response.statusCode === 429) {
          const delay = retryDelay(response, deps.wallNow());
          if (delay !== null) {
            const until = deps.now() + delay;
            if (until > (limits.get(limitKey)?.until ?? -Infinity)) {
              limits.set(limitKey, { until, response });
            }
          }
        }
        return response;
      })
      .finally(() => {
        // An old connection must not clear a replacement connection's request.
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  };
  return { read, observeCredentials };
}

const claudeAccountReader = createClaudeAccountReader({
  request: (request) => apiCallApi.request(request, { timeout: 12_000 }),
  revision: () => apiClient.getConnectionRevision(),
  now: () => performance.now(),
  wallNow: () => Date.now(),
});

export const readClaudeAccount = claudeAccountReader.read;
export const observeClaudeCredentials = claudeAccountReader.observeCredentials;
