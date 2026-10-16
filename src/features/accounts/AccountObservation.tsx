import { useTranslation } from 'react-i18next';
import type { AccountBillingStatus, AccountProfileStatus } from './types';
import { accountDate } from './presentation';
import styles from './AccountsPage.module.scss';

interface AccountObservationProps {
  kind: 'profile' | 'billing';
  status: AccountProfileStatus | AccountBillingStatus;
  checkedAt: string | null;
  successAt: string | null;
}

export function AccountObservation({
  kind,
  status,
  checkedAt,
  successAt,
}: AccountObservationProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || 'en';
  const checked = accountDate(checkedAt, locale);
  const success = accountDate(successAt, locale);
  return (
    <div className={styles.observation}>
      <span className={status === 'stale' || status === 'unavailable' ? styles.warning : ''}>
        {t(`accounts.${kind}`)}: {t(`accounts.status_${status}`)}
      </span>
      <small>
        {checked ? t('accounts.checked_at', { date: checked }) : t('accounts.not_checked')}
      </small>
      {success && successAt !== checkedAt && (
        <small>{t('accounts.succeeded_at', { date: success })}</small>
      )}
    </div>
  );
}
