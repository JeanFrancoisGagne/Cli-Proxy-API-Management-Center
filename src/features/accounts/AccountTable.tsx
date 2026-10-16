import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ManagedAccount } from './types';
import { accountDate, accountEmail, accountTitle } from './presentation';
import { AccountObservation } from './AccountObservation';
import styles from './AccountsPage.module.scss';

interface AccountTableProps {
  accounts: readonly ManagedAccount[];
  showEmails: boolean;
  onSelect: (authIndex: string) => void;
}

export function AccountTable({ accounts, showEmails, onSelect }: AccountTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || 'en';
  const missing = t('accounts.not_reported');
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>{t('accounts.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('accounts.login_identity')}</th>
            <th scope="col">{t('accounts.subscription')}</th>
            <th scope="col">{t('accounts.billing_identity')}</th>
            <th scope="col">{t('accounts.dates')}</th>
            <th scope="col">{t('accounts.freshness')}</th>
            <th scope="col">
              <span className={styles.srOnly}>{t('accounts.details')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.authIndex}>
              <th scope="row">
                <span className={styles.accountName}>{accountTitle(account, showEmails)}</span>
                <span className={styles.secondary}>
                  {accountEmail(account.email, showEmails) || missing}
                </span>
                <span className={styles.provider}>
                  {account.provider}
                  {account.disabled ? ` · ${t('accounts.disabled')}` : ''}
                </span>
              </th>
              <td>
                <strong>{t(`accounts.plan_${account.profile.plan}`)}</strong>
                <span className={styles.secondary}>
                  {account.profile.subscriptionStatus || missing}
                </span>
              </td>
              <td>
                <span>{account.billing.billingName || missing}</span>
                <span className={styles.secondary}>
                  {accountEmail(account.billing.billingEmail, showEmails) || missing}
                </span>
              </td>
              <td>
                <dl className={styles.dates}>
                  <div>
                    <dt>{t('accounts.started')}</dt>
                    <dd>{accountDate(account.profile.subscriptionStartedAt, locale) || missing}</dd>
                  </div>
                  <div>
                    <dt>{t('accounts.renewal')}</dt>
                    <dd>{accountDate(account.billing.renewalAt, locale) || missing}</dd>
                  </div>
                  <div>
                    <dt>{t('accounts.period_end')}</dt>
                    <dd>{accountDate(account.billing.periodEnd, locale) || missing}</dd>
                  </div>
                </dl>
              </td>
              <td>
                <AccountObservation
                  kind="profile"
                  status={account.profile.status}
                  checkedAt={account.profile.lastCheckedAt}
                  successAt={account.profile.lastSuccessAt}
                />
                <AccountObservation
                  kind="billing"
                  status={account.billing.status}
                  checkedAt={account.billing.lastCheckedAt}
                  successAt={account.billing.lastSuccessAt}
                />
              </td>
              <td>
                <Button variant="secondary" size="sm" onClick={() => onSelect(account.authIndex)}>
                  {t('accounts.details')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
