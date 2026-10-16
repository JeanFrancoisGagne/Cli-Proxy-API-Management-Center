import type { ManagedAccount } from './types';
import { maskCredentialName, maskEmail } from '@/features/quota/credentialMask';
import { formatDateTimeValue } from '@/utils/format';

export function accountTitle(account: ManagedAccount, reveal: boolean): string {
  const title =
    account.profile.displayName || account.profile.fullName || account.email || account.name;
  return reveal ? title : maskCredentialName(title, account.email);
}

export function accountEmail(value: string | null, reveal: boolean): string | null {
  return value ? (reveal ? value : maskEmail(value)) : null;
}

export function accountDate(value: string | null, locale: string): string | null {
  // A receipt's printed calendar date has no timezone; keep its calendar day.
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' });
  }
  return value ? formatDateTimeValue(value, locale) || null : null;
}

export function invoiceAmount(amountMinor: number, currency: string, locale: string): string {
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}
