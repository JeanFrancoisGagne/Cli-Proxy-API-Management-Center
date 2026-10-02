/**
 * Mask the email inside a credential name, e.g. `claude-theo@t3.gg.json` →
 * `claude-t•••@t•••.gg.json`.
 *
 * Auth file names embed the account email (`claude-<hash>-<email>.json`,
 * `codex-<hash>-<email>-<plan>.json`), so the quota page hides it by default to
 * keep it off screenshots and screen shares. The first character of the local
 * part and of the domain stay visible, plus the top-level domain, which is
 * enough to tell one's own accounts apart.
 *
 * Pure and React-free: consumed directly by tests/quotaCredentialMask.test.ts.
 */

export const MASK = '•••';

/**
 * Hyphen is left out of the local part on purpose: file names put a
 * `provider-` or `provider-<hash>-` prefix right before the email, and a
 * hyphenated local part would swallow it (`c•••@…` instead of `claude-t•••@…`).
 * The TLD is letters only so a `-plus` plan suffix after the email stays outside.
 */
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g;

const FILE_EXTENSION = /\.json$/i;

/** `theo@t3.gg` → `t•••@t•••.gg`. Input without an `@` is masked as a whole. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email ? `${email.charAt(0)}${MASK}` : email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const lastDot = domain.lastIndexOf('.');
  const maskedDomain =
    lastDot > 0
      ? `${domain.charAt(0)}${MASK}${domain.slice(lastDot)}`
      : `${domain.charAt(0)}${MASK}`;
  return `${local.charAt(0)}${MASK}@${maskedDomain}`;
}

/**
 * Mask every email inside a credential name.
 *
 * `email` is the auth file's own email field. When the name contains it, that
 * exact span is masked, which handles hyphenated local parts the pattern
 * cannot. Anything else that looks like an email is masked by pattern.
 */
export function maskCredentialName(name: string, email?: string | null): string {
  const extension = FILE_EXTENSION.exec(name)?.[0] ?? '';
  let stem = extension ? name.slice(0, -extension.length) : name;

  const knownEmail = email?.trim();
  if (knownEmail && knownEmail.includes('@')) {
    const index = stem.toLowerCase().indexOf(knownEmail.toLowerCase());
    if (index !== -1) {
      stem = stem.slice(0, index) + maskEmail(knownEmail) + stem.slice(index + knownEmail.length);
    }
  }

  return stem.replace(EMAIL_PATTERN, (match) => maskEmail(match)) + extension;
}
