import { normalizePlanType } from './parsers';

/**
 * Codex 套餐档位 → 徽章样式的纯映射。
 *
 * - elite   → 液态铂金徽章（Pro 20x，plan=pro）
 * - premium → 金卡徽章（Pro Lite；Antigravity ultra / xAI paid 亦复用金卡类名）
 * - plain   → 普通文字徽章（plus/team/free/未知）
 */
export type CodexPlanTier = 'elite' | 'premium' | 'plain';

export const PREMIUM_CODEX_PLAN_TYPES = new Set([
  'pro',
  'prolite',
  'pro-lite',
  'pro_lite',
  'self_serve_business_prolite',
]);

// Pro 20x（plan=pro）在金色 premium 之上再进一档：液态铂金徽章，
// 见 QuotaPage.module.scss 的 .elitePlanValue。
export const ELITE_CODEX_PLAN_TYPE = 'pro';

/**
 * 顺序敏感：'pro' 同时命中 PREMIUM_CODEX_PLAN_TYPES，elite 判断必须在最前，
 * 否则 Pro 20x 会静默退回金卡。契约由 tests/quotaPlanTier.test.ts 守护。
 */
export function resolvePlanTier(planType: string | null | undefined): CodexPlanTier {
  const normalized = normalizePlanType(planType);
  if (!normalized) return 'plain';
  if (normalized === ELITE_CODEX_PLAN_TYPE) return 'elite';
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 'premium';
  return 'plain';
}

/**
 * i18n key (under `codex_quota.`) for a Codex plan, or null when the plan has
 * no translated label. Shared by the quota card and the quota ledger.
 */
export function codexPlanLabelKey(planType: string | null | undefined): string | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') return 'codex_quota.plan_business_premium';
  if (normalized === ELITE_CODEX_PLAN_TYPE) return 'codex_quota.plan_pro';
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 'codex_quota.plan_prolite';
  if (normalized === 'plus') return 'codex_quota.plan_plus';
  if (normalized === 'team') return 'codex_quota.plan_team';
  if (normalized === 'free') return 'codex_quota.plan_free';
  return null;
}
