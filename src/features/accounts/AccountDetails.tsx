import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { maskCredentialName } from '@/features/quota/credentialMask';
import { AccountObservation } from './AccountObservation';
import { accountDate, accountEmail, invoiceAmount } from './presentation';
import type { ManagedAccount } from './types';
import styles from './AccountsPage.module.scss';

interface AccountDetailsProps {
  account: ManagedAccount;
  showEmails: boolean;
  downloadingInvoiceId: string | null;
  onDownload: (invoiceId: string) => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function AccountDetails({
  account,
  showEmails,
  downloadingInvoiceId,
  onDownload,
}: AccountDetailsProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || 'en';
  const missing = t('accounts.not_reported');
  const date = (value: string | null) => accountDate(value, locale) || missing;
  const email = (value: string | null) => accountEmail(value, showEmails) || missing;
  const privateText = (value: string | null) =>
    value ? (showEmails ? value : maskCredentialName(value)) : missing;
  const { profile, billing } = account;
  const invoices = [...billing.invoices].sort(
    (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
  );

  return (
    <div className={styles.details}>
      <section className={styles.section}>
        <h3>{t('accounts.identities')}</h3>
        <dl className={styles.facts}>
          <Fact label={t('accounts.login_name')}>
            {privateText(profile.fullName || profile.displayName)}
          </Fact>
          <Fact label={t('accounts.login_email')}>{email(account.email)}</Fact>
          <Fact label={t('accounts.billing_name')}>{billing.billingName || missing}</Fact>
          <Fact label={t('accounts.billing_email')}>{email(billing.billingEmail)}</Fact>
          <Fact label={t('accounts.organization')}>{profile.organizationName || missing}</Fact>
          <Fact label={t('accounts.credential_file_label')}>{privateText(account.name)}</Fact>
        </dl>
      </section>
      <section className={styles.section}>
        <h3>{t('accounts.subscription')}</h3>
        <dl className={styles.facts}>
          <Fact label={t('accounts.plan')}>{t(`accounts.plan_${profile.plan}`)}</Fact>
          <Fact label={t('accounts.subscription_status')}>
            {profile.subscriptionStatus || missing}
          </Fact>
          <Fact label={t('accounts.started')}>{date(profile.subscriptionStartedAt)}</Fact>
          <Fact label={t('accounts.renewal')}>{date(billing.renewalAt)}</Fact>
          <Fact label={t('accounts.period_end')}>{date(billing.periodEnd)}</Fact>
        </dl>
        <p className={styles.note}>{t('accounts.date_note')}</p>
      </section>
      <section className={styles.section}>
        <h3>{t('accounts.freshness')}</h3>
        <p className={styles.note}>
          {profile.source ? t('accounts.source_profile') : t('accounts.source_unavailable')}
        </p>
        <AccountObservation
          kind="profile"
          status={profile.status}
          checkedAt={profile.lastCheckedAt}
          successAt={profile.lastSuccessAt}
        />
        <p className={styles.note}>{t('accounts.source_receipt')}</p>
        <AccountObservation
          kind="billing"
          status={billing.status}
          checkedAt={billing.lastCheckedAt}
          successAt={billing.lastSuccessAt}
        />
      </section>
      <section className={styles.section}>
        <h3>{t('accounts.invoices', { count: invoices.length })}</h3>
        {invoices.length === 0 && <p className={styles.note}>{t('accounts.no_invoices')}</p>}
        {invoices.map((invoice) => (
          <article className={styles.invoice} key={invoice.invoiceId}>
            <div className={styles.invoiceHead}>
              <h4>{invoice.invoiceId}</h4>
              <strong>{invoiceAmount(invoice.amountMinor, invoice.currency, locale)}</strong>
            </div>
            <dl className={styles.facts}>
              <Fact label={t('accounts.issued')}>{date(invoice.issuedAt)}</Fact>
              <Fact label={t('accounts.billing_name')}>{invoice.billingName || missing}</Fact>
              <Fact label={t('accounts.billing_email')}>{email(invoice.billingEmail)}</Fact>
              <Fact label={t('accounts.period_start')}>{date(invoice.periodStart)}</Fact>
              <Fact label={t('accounts.period_end')}>{date(invoice.periodEnd)}</Fact>
              <Fact label={t('accounts.renewal')}>{date(invoice.renewalAt)}</Fact>
            </dl>
            {invoice.pdfRef ? (
              <Button
                variant="secondary"
                size="sm"
                loading={downloadingInvoiceId === invoice.invoiceId}
                disabled={downloadingInvoiceId !== null}
                onClick={() => onDownload(invoice.invoiceId)}
              >
                {t('accounts.download_pdf')}
              </Button>
            ) : (
              <p className={styles.note}>{t('accounts.pdf_unavailable')}</p>
            )}
            <details className={styles.sourceDetails}>
              <summary>{t('accounts.receipt_source')}</summary>
              <dl className={styles.facts}>
                <Fact label={t('accounts.mailbox')}>{email(invoice.sourceMailbox)}</Fact>
                <Fact label={t('accounts.message_id')}>{invoice.sourceMessageId}</Fact>
                <Fact label={t('accounts.authentication')}>
                  {invoice.sourceAuthentication
                    ? t(`accounts.auth_${invoice.sourceAuthentication}`)
                    : missing}
                </Fact>
                <Fact label={t('accounts.evidence_hash')}>
                  <code className={styles.reference}>{invoice.evidenceSha256}</code>
                </Fact>
              </dl>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
