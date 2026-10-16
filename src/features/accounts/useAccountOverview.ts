import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { accountsApi } from '@/services/api/accounts';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { useInterval } from '@/hooks/useInterval';
import { createAccountOverviewStore } from './overviewStore';

const OVERVIEW_REFRESH_MS = 30_000;

export function useAccountOverview(enabled: boolean) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const [store] = useState(() =>
    createAccountOverviewStore({
      read: accountsApi.list,
      revision: () => apiClient.getConnectionRevision(),
      now: () => Date.now(),
    })
  );
  const snapshot = useStore(store);
  const active = enabled && connectionStatus === 'connected';
  const refresh = store.getState().load;

  useEffect(() => {
    store.getState().reset();
    if (active) void refresh();
    return () => store.getState().reset();
  }, [active, apiBase, managementKey, refresh, store]);

  useInterval(
    () => {
      if (document.visibilityState !== 'hidden') void refresh();
    },
    active ? OVERVIEW_REFRESH_MS : null
  );

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active, refresh]);

  // Do not render the preceding connection's data before its cleanup effect runs.
  const current = active && snapshot.revision === apiClient.getConnectionRevision();
  return {
    ...snapshot,
    accounts: current ? snapshot.accounts : [],
    receivedAt: current ? snapshot.receivedAt : null,
    error: current ? snapshot.error : null,
    refresh,
    connected: active,
  };
}
