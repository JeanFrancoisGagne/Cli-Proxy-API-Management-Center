import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import { accountsApi } from '@/services/api/accounts';
import { downloadBlob } from '@/utils/download';
import { accountDate, accountTitle } from './presentation';
import { AccountDetails } from './AccountDetails';
import { AccountTable } from './AccountTable';
import { useAccountOverview } from './useAccountOverview';
import styles from './AccountsPage.module.scss';

export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const layer = usePageTransitionLayer();
  const active = !layer || layer.status === 'current';
  const overview = useAccountOverview(active);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('all');
  const [showEmails, setShowEmails] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const downloadRequest = useRef(0);
  const revision = apiClient.getConnectionRevision();
  useHeaderRefresh(overview.refresh, active && overview.connected);

  useEffect(() => {
    downloadRequest.current += 1;
    setSelectedId(null);
    setDownloadingId(null);
    setDownloadError('');
    setShowEmails(false);
  }, [revision]);

  useEffect(
    () => () => {
      downloadRequest.current += 1;
    },
    []
  );

  const providers = useMemo(
    () => [
      { value: 'all', label: t('accounts.all_providers') },
      ...[...new Set(overview.accounts.map((account) => account.provider))]
        .sort()
        .map((value) => ({ value, label: value })),
    ],
    [overview.accounts, t]
  );
  const accounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return overview.accounts.filter(
      (account) =>
        (provider === 'all' || account.provider === provider) &&
        (!query ||
          [
            account.name,
            account.email,
            account.profile.fullName,
            account.profile.displayName,
            account.billing.billingName,
            account.billing.billingEmail,
          ].some((value) => value?.toLowerCase().includes(query)))
    );
  }, [overview.accounts, provider, search]);
  const selected = overview.accounts.find((account) => account.authIndex === selectedId);
  const busy = overview.status === 'loading' || overview.status === 'refreshing';
  const received =
    overview.receivedAt === null
      ? null
      : accountDate(new Date(overview.receivedAt).toISOString(), i18n.resolvedLanguage || 'en');

  const download = useCallback(
    async (invoiceId: string) => {
      if (!selected || downloadingId !== null) return;
      const request = ++downloadRequest.current;
      const requestRevision = apiClient.getConnectionRevision();
      setDownloadingId(invoiceId);
      setDownloadError('');
      try {
        const blob = await accountsApi.downloadInvoice(selected.authIndex, invoiceId);
        if (
          request !== downloadRequest.current ||
          requestRevision !== apiClient.getConnectionRevision()
        )
          return;
        const filename = `invoice-${invoiceId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)}.pdf`;
        downloadBlob({ blob, filename });
      } catch {
        if (request === downloadRequest.current) setDownloadError(t('accounts.download_failed'));
      } finally {
        if (request === downloadRequest.current) setDownloadingId(null);
      }
    },
    [downloadingId, selected, t]
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('accounts.title')}</h1>
          <p className={styles.description}>{t('accounts.description')}</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            aria-pressed={showEmails}
            onClick={() => setShowEmails((value) => !value)}
          >
            {t(showEmails ? 'accounts.hide_emails' : 'accounts.show_emails')}
          </Button>
          <Button
            loading={busy}
            disabled={!overview.connected}
            onClick={() => void overview.refresh()}
          >
            {t('accounts.refresh')}
          </Button>
        </div>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('accounts.search')}
            aria-label={t('accounts.search')}
          />
        </div>
        <div className={styles.filter}>
          <Select
            value={provider}
            options={providers}
            onChange={setProvider}
            ariaLabel={t('accounts.provider')}
          />
        </div>
      </div>
      <div className={styles.summary} aria-live="polite">
        {t('accounts.count', { count: accounts.length })}
        {received ? ` · ${t('accounts.overview_checked', { date: received })}` : ''}
      </div>
      {overview.error && (
        <div className={styles.error} role="alert">
          {t('accounts.load_failed')}
          {overview.receivedAt !== null ? ` ${t('accounts.showing_previous')}` : ''}
          <div>{overview.error}</div>
        </div>
      )}
      {(busy || overview.status === 'idle') && overview.receivedAt === null ? (
        <Skeleton height={220} rounded={12} />
      ) : accounts.length > 0 ? (
        <AccountTable accounts={accounts} showEmails={showEmails} onSelect={setSelectedId} />
      ) : (
        !overview.error && (
          <EmptyState
            title={t('accounts.empty_title')}
            description={t('accounts.empty_description')}
          />
        )
      )}
      <Sheet
        open={Boolean(selected)}
        onClose={() => {
          setSelectedId(null);
          setDownloadError('');
        }}
        size="lg"
        title={selected ? accountTitle(selected, showEmails) : ''}
      >
        {downloadError && (
          <div className={styles.error} role="alert">
            {downloadError}
          </div>
        )}
        {selected && (
          <AccountDetails
            account={selected}
            showEmails={showEmails}
            downloadingInvoiceId={downloadingId}
            onDownload={(invoiceId) => void download(invoiceId)}
          />
        )}
      </Sheet>
    </div>
  );
}
