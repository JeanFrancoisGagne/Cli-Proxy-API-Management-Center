export type AccountProfileStatus = 'ok' | 'stale' | 'unavailable' | 'pending';
export type AccountBillingStatus = 'ok' | 'empty' | 'stale' | 'unavailable';
export type AccountPlan = 'max' | 'pro' | 'team' | 'free' | 'unknown';

export interface AccountProfile {
  status: AccountProfileStatus;
  source: 'claude_oauth_profile' | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  fullName: string | null;
  displayName: string | null;
  organizationName: string | null;
  plan: AccountPlan;
  subscriptionStatus: string | null;
  subscriptionStartedAt: string | null;
  errorCode: string | null;
}

export interface AccountInvoice {
  invoiceId: string;
  issuedAt: string;
  currency: string;
  amountMinor: number;
  billingName: string | null;
  billingEmail: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  renewalAt: string | null;
  pdfRef: string | null;
  sourceMailbox: string;
  sourceMessageId: string;
  evidenceSha256: string;
  sourceAuthentication: 'gmail_direct' | 'gmail_arc' | null;
}

export interface AccountBilling {
  status: AccountBillingStatus;
  source: 'gmail_receipt';
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string | null;
  billingName: string | null;
  billingEmail: string | null;
  renewalAt: string | null;
  periodEnd: string | null;
  errorCode: string | null;
  invoices: AccountInvoice[];
}

export interface ManagedAccount {
  authIndex: string;
  name: string;
  provider: string;
  email: string;
  disabled: boolean;
  profile: AccountProfile;
  billing: AccountBilling;
}
