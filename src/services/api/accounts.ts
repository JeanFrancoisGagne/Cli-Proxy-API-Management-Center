import { apiClient } from './client';
import type {
  AccountBilling,
  AccountBillingStatus,
  AccountInvoice,
  AccountPlan,
  AccountProfile,
  AccountProfileStatus,
  ManagedAccount,
} from '@/features/accounts/types';
import { isRecord } from '@/utils/helpers';

const malformed = () => new Error('Invalid account overview response');

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw malformed();
  return value;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value: unknown): string {
  const result = text(value);
  if (result === null) throw malformed();
  return result;
}

function timestamp(value: unknown): string | null {
  const result = text(value);
  if (
    !result ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)
  ) {
    return null;
  }
  return Number.isFinite(Date.parse(result)) ? result : null;
}

function billingDate(value: unknown): string | null {
  const result = text(value);
  if (result && /^\d{4}-\d{2}-\d{2}$/.test(result)) {
    const date = new Date(`${result}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result
      ? result
      : null;
  }
  return timestamp(value);
}

function profileStatus(value: unknown): AccountProfileStatus {
  if (value === 'ok' || value === 'stale' || value === 'unavailable' || value === 'pending') {
    return value;
  }
  throw malformed();
}

function billingStatus(value: unknown): AccountBillingStatus {
  if (value === 'ok' || value === 'empty' || value === 'stale' || value === 'unavailable') {
    return value;
  }
  throw malformed();
}

function plan(value: unknown): AccountPlan {
  if (value === 'max' || value === 'pro' || value === 'team' || value === 'free') return value;
  return 'unknown';
}

function profile(value: unknown): AccountProfile {
  const data = record(value);
  const source = text(data.source);
  if (source !== null && source !== 'claude_oauth_profile') throw malformed();
  return {
    status: profileStatus(data.status),
    source,
    lastCheckedAt: timestamp(data.last_checked_at),
    lastSuccessAt: timestamp(data.last_success_at),
    fullName: text(data.full_name),
    displayName: text(data.display_name),
    organizationName: text(data.organization_name),
    plan: plan(data.plan),
    subscriptionStatus: text(data.subscription_status),
    subscriptionStartedAt: timestamp(data.subscription_started_at),
    errorCode: text(data.error_code),
  };
}

function invoice(value: unknown): AccountInvoice {
  const data = record(value);
  const issuedAt = billingDate(data.issued_at);
  if (
    !issuedAt ||
    typeof data.amount_minor !== 'number' ||
    !Number.isSafeInteger(data.amount_minor)
  ) {
    throw malformed();
  }
  return {
    invoiceId: requiredText(data.invoice_id),
    issuedAt,
    currency: requiredText(data.currency),
    amountMinor: data.amount_minor,
    billingName: text(data.billing_name),
    billingEmail: text(data.billing_email),
    periodStart: billingDate(data.period_start),
    periodEnd: billingDate(data.period_end),
    renewalAt: billingDate(data.renewal_at),
    pdfRef: text(data.pdf_ref),
    sourceMailbox: requiredText(data.source_mailbox),
    sourceMessageId: requiredText(data.source_message_id),
    evidenceSha256: requiredText(data.evidence_sha256),
    sourceAuthentication:
      data.source_authentication === 'gmail_direct' || data.source_authentication === 'gmail_arc'
        ? data.source_authentication
        : null,
  };
}

function billing(value: unknown): AccountBilling {
  const data = record(value);
  if (data.source !== 'gmail_receipt' || !Array.isArray(data.invoices)) throw malformed();
  return {
    status: billingStatus(data.status),
    source: data.source,
    lastCheckedAt: timestamp(data.last_checked_at),
    lastSuccessAt: timestamp(data.last_success_at),
    updatedAt: timestamp(data.updated_at),
    billingName: text(data.billing_name),
    billingEmail: text(data.billing_email),
    renewalAt: billingDate(data.renewal_at),
    periodEnd: billingDate(data.period_end),
    errorCode: text(data.error_code),
    invoices: data.invoices.map(invoice),
  };
}

export function parseAccountOverview(value: unknown): ManagedAccount[] {
  const data = record(value);
  if (!Array.isArray(data.accounts)) throw malformed();
  const seen = new Set<string>();
  return data.accounts.map((item) => {
    const account = record(item);
    const authIndex = requiredText(account.auth_index);
    if (seen.has(authIndex) || typeof account.disabled !== 'boolean') throw malformed();
    seen.add(authIndex);
    return {
      authIndex,
      name: requiredText(account.name),
      provider: requiredText(account.provider),
      email: text(account.email) ?? '',
      disabled: account.disabled,
      profile: profile(account.profile),
      billing: billing(account.billing),
    };
  });
}

export const accountsApi = {
  list: async (): Promise<ManagedAccount[]> =>
    parseAccountOverview(await apiClient.get<unknown>('/credentials/accounts')),
  downloadInvoice: async (authIndex: string, invoiceId: string): Promise<Blob> => {
    const response = await apiClient.getRaw('/credentials/accounts/invoice', {
      params: { auth_index: authIndex, invoice_id: invoiceId },
      responseType: 'blob',
    });
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/pdf') || !(response.data instanceof Blob)) {
      throw new Error('Invalid invoice PDF response');
    }
    return response.data;
  },
};
