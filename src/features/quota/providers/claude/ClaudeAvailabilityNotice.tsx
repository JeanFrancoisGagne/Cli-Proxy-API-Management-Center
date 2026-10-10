import { useTranslation } from 'react-i18next';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import type { ClaudeAvailability } from './availability';

interface NoticeProps {
  availability: ClaudeAvailability;
  windowLabel: (id: string) => string;
  nowMs: number;
  className?: string;
}

export function ClaudeAvailabilityNotice({
  availability,
  windowLabel,
  nowMs,
  className,
}: NoticeProps) {
  const { t, i18n } = useTranslation();
  if (availability.status === 'available') return null;
  if (availability.status === 'unknown') {
    return <div className={className}>{t('claude_quota.included_unknown')}</div>;
  }
  return (
    <div className={className} role="status">
      <div>
        {t('claude_quota.included_blocked', {
          windows: availability.windowIds.map(windowLabel).join(', '),
        })}
      </div>
      <div>
        {availability.resetAtMs === null
          ? t('claude_quota.included_reset_unknown')
          : `${t('claude_quota.included_reset')}: ${formatRelativeInstant(availability.resetAtMs, nowMs, i18n.resolvedLanguage)} · ${formatInstantShort(availability.resetAtMs)}`}
      </div>
    </div>
  );
}
