import { createStore } from 'zustand/vanilla';
import type { ManagedAccount } from './types';

type OverviewState = {
  accounts: ManagedAccount[];
  receivedAt: number | null;
  revision: number;
} & (
  | { status: 'idle' | 'loading' | 'refreshing' | 'ready'; error: null }
  | { status: 'error'; error: string }
);

type OverviewActions = {
  load: () => Promise<void>;
  reset: () => void;
};

interface OverviewDependencies {
  read: () => Promise<ManagedAccount[]>;
  revision: () => number;
  now: () => number;
}

export function createAccountOverviewStore(deps: OverviewDependencies) {
  let requestId = 0;
  let inFlight: Promise<void> | null = null;

  return createStore<OverviewState & OverviewActions>()((set, get) => ({
    accounts: [],
    receivedAt: null,
    revision: deps.revision(),
    status: 'idle',
    error: null,
    reset: () => {
      requestId += 1;
      inFlight = null;
      set({
        accounts: [],
        receivedAt: null,
        revision: deps.revision(),
        status: 'idle',
        error: null,
      });
    },
    load: () => {
      const revision = deps.revision();
      if (get().revision !== revision) get().reset();
      if (inFlight) return inFlight;
      const currentRequest = ++requestId;
      const isCurrent = () => requestId === currentRequest && deps.revision() === revision;
      set({ status: get().receivedAt === null ? 'loading' : 'refreshing', error: null });

      inFlight = (async () => {
        try {
          const accounts = await deps.read();
          if (!isCurrent()) return;
          set({ accounts, receivedAt: deps.now(), revision, status: 'ready', error: null });
        } catch (error: unknown) {
          if (!isCurrent()) return;
          set({
            status: 'error',
            error: error instanceof Error ? error.message : 'Account overview request failed',
          });
        } finally {
          if (requestId === currentRequest) inFlight = null;
        }
      })();
      return inFlight;
    },
  }));
}
