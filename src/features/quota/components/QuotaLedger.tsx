/**
 * Quota ledger view: one summary card per provider, then one row per credential.
 *
 * The summary card sums remaining weekly quota across a provider's accounts
 * ("409% of 500%") with one bar segment per account. The rows below show each
 * account's windows side by side, ordered so the account whose weekly quota is
 * lost first comes first (see ledger.ts).
 */

import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant, resolveQuotaErrorMessage } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import {
  buildLedgerSections,
  remainingLevel,
  type LedgerLabel,
  type LedgerRow,
  type LedgerSection,
  type LedgerSortMode,
  type LedgerWindow,
  type LedgerWindowTotal,
  type RemainingLevel,
} from '../ledger';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaLedger.module.scss';

const WEEK_HOURS = 24 * 7;

const LEVEL_CLASS: Record<RemainingLevel, string | undefined> = {
  high: styles.levelHigh,
  medium: styles.levelMedium,
  low: styles.levelLow,
  unknown: styles.levelUnknown,
};

const levelClass = (remaining: number | null) => LEVEL_CLASS[remainingLevel(remaining)] ?? '';

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

const fillStyle = (remaining: number | null): CSSProperties => ({
  width: `${remaining === null ? 0 : Math.round(remaining * 100) / 100}%`,
});

/** Translate a ledger label, falling back to the provider's own text. */
function useLabelText() {
  const { t } = useTranslation();
  return useCallback(
    (label: LedgerLabel) =>
      label.key ? t(label.key, { ...label.params, defaultValue: label.text }) : label.text,
    [t]
  );
}

export interface QuotaLedgerProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  sortMode: LedgerSortMode;
  /** Name shown for a credential; masked while emails are hidden. */
  nameFor: (file: AuthFileItem) => string;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
  /** Injectable for tests; defaults to the shared minute clock. */
  now?: number;
}

export function QuotaLedger({
  entries,
  quotaFor,
  sortMode,
  nameFor,
  resolvedTheme,
  canRefresh,
  onRefresh,
  now: nowProp,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  const tick = useNow(nowProp === undefined);
  const now = nowProp ?? tick;

  const sections = useMemo(
    () => buildLedgerSections(entries, quotaFor, sortMode, now),
    [entries, quotaFor, sortMode, now]
  );

  return (
    <div className={styles.ledger}>
      <section className={styles.summary} aria-label={t('quota_management.ledger_summary_label')}>
        {sections.map((section) => (
          <SummaryCard
            key={section.provider}
            section={section}
            resolvedTheme={resolvedTheme}
            now={now}
          />
        ))}
      </section>

      {sections.map((section) => {
        const headingId = `quota-ledger-${section.provider}`;
        return (
          <section key={section.provider} className={styles.section} aria-labelledby={headingId}>
            <h2 className={styles.sectionTitle} id={headingId}>
              {getTypeLabel(t, section.provider)}
              <span className={styles.sectionCount}>{section.rows.length}</span>
            </h2>
            <ul className={styles.rows}>
              {section.rows.map((row) => (
                <LedgerRowItem
                  key={row.key}
                  row={row}
                  name={nameFor(row.entry.file)}
                  canRefresh={canRefresh}
                  now={now}
                  onRefresh={() => onRefresh(row.entry)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

/** `in 1 day · 09/12, 23:00`, or "No reset pending". */
function ResetLine({ atMs, now }: { atMs: number | null; now: number }) {
  const { t, i18n } = useTranslation();
  if (atMs === null) {
    return <span className={styles.resetNone}>{t('quota_management.ledger_no_reset')}</span>;
  }
  return (
    <>
      <span className={styles.resetRelative}>
        {formatRelativeInstant(atMs, now, i18n.resolvedLanguage)}
      </span>
      <span className={styles.resetAbsolute}>{` · ${formatInstantShort(atMs)}`}</span>
    </>
  );
}

function ProviderIcon({
  provider,
  resolvedTheme,
}: {
  provider: QuotaProviderType;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  return (
    <span
      className={styles.iconWrap}
      aria-hidden="true"
      style={
        isThemeSurfaceIconProvider(provider)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.iconFallback}>
          {getTypeLabel(t, provider).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

interface SummaryCardProps {
  section: LedgerSection;
  resolvedTheme: ResolvedTheme;
  now: number;
}

function SummaryCard({ section, resolvedTheme, now }: SummaryCardProps) {
  const { t } = useTranslation();
  const labelText = useLabelText();
  const [expanded, setExpanded] = useState(false);
  const { summary } = section;
  const primary = summary.primary;

  // A second weekly bucket (Claude's general 7-day limit beside the Fable one)
  // is always shown; everything else waits behind the toggle.
  const [first, ...rest] = summary.secondary;
  const inline = first && (first.periodHours ?? 0) >= WEEK_HOURS ? first : null;
  const hidden = inline ? rest : summary.secondary;

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <ProviderIcon provider={section.provider} resolvedTheme={resolvedTheme} />
        <span className={styles.cardTitle}>{getTypeLabel(t, section.provider)}</span>
        <span className={styles.cardCount}>
          {t('quota_management.ledger_credentials', { count: summary.credentials })}
        </span>
      </header>

      <div className={styles.cardLabel}>
        {primary ? labelText(primary.label) : t('quota_management.ledger_weekly_fallback')}
      </div>
      <div className={styles.cardFigure}>
        <span className={styles.cardValue}>{formatPercent(primary?.remainingSum ?? null)}</span>
        <span className={styles.cardCapacity}>
          {t('quota_management.ledger_of_capacity', { capacity: summary.capacity })}
        </span>
      </div>

      <div className={styles.segments} aria-hidden="true">
        {summary.segments.map((segment) => (
          <span key={segment.key} className={styles.segment}>
            <span
              className={`${styles.segmentFill} ${levelClass(segment.remaining)}`}
              style={fillStyle(segment.remaining)}
            />
          </span>
        ))}
      </div>

      <div className={styles.cardReset}>
        <ResetLine atMs={primary?.soonestResetMs ?? null} now={now} />
      </div>

      {summary.secondary.length > 0 && (
        <div className={styles.secondary}>
          <div className={styles.secondaryHead}>
            {inline ? (
              <SecondaryTotal total={inline} />
            ) : (
              <span className={styles.secondaryLabel}>
                {t('quota_management.ledger_other_windows')}
              </span>
            )}
            {hidden.length > 0 && (
              <button
                type="button"
                className={styles.secondaryToggle}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? t('quota_management.ledger_secondary_hide')
                  : t('quota_management.ledger_secondary_show')}
              </button>
            )}
          </div>
          {expanded && hidden.map((total) => <SecondaryTotal key={total.id} total={total} />)}
        </div>
      )}
    </article>
  );
}

function SecondaryTotal({ total }: { total: LedgerWindowTotal }) {
  const labelText = useLabelText();
  return (
    <span className={styles.secondaryTotal}>
      <span className={styles.secondaryLabel}>{labelText(total.label)}</span>
      <span className={styles.secondaryValue}>{formatPercent(total.remainingSum)}</span>
    </span>
  );
}

interface LedgerRowItemProps {
  row: LedgerRow;
  name: string;
  canRefresh: boolean;
  now: number;
  onRefresh: () => void;
}

function LedgerRowItem({ row, name, canRefresh, now, onRefresh }: LedgerRowItemProps) {
  const { t } = useTranslation();
  const labelText = useLabelText();
  const prefix = QUOTA_ADAPTERS[row.entry.type].i18nPrefix;
  const loading = row.status === 'loading';

  let body: ReactNode;
  if (row.status === 'success') {
    body =
      row.windows.length > 0 ? (
        row.windows.map((window) => <WindowCell key={window.id} window={window} now={now} />)
      ) : (
        <span className={styles.message}>{t('quota_management.ledger_no_windows')}</span>
      );
  } else if (row.status === 'error') {
    const message = resolveQuotaErrorMessage(
      t,
      row.errorStatus,
      row.error || t('common.unknown_error')
    );
    body = (
      <span className={styles.error} role="alert">
        {t(`${prefix}.load_failed`, { message })}
      </span>
    );
  } else if (loading) {
    body = (
      <span className={styles.message} aria-busy="true">
        {t(`${prefix}.loading`)}
      </span>
    );
  } else {
    body = <span className={styles.message}>{t('quota_management.ledger_not_loaded')}</span>;
  }

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        {row.plan && <span className={styles.plan}>{labelText(row.plan)}</span>}
      </div>
      <div className={styles.windows}>{body}</div>
      <button
        type="button"
        className={styles.refresh}
        onClick={onRefresh}
        disabled={!canRefresh || loading}
        title={t('auth_files.quota_refresh_hint')}
      >
        <IconRefreshCw
          size={13}
          aria-hidden="true"
          className={loading ? styles.spinning : undefined}
        />
        {t('auth_files.quota_refresh_single')}
      </button>
    </li>
  );
}

function WindowCell({ window, now }: { window: LedgerWindow; now: number }) {
  const labelText = useLabelText();
  return (
    <div className={styles.window}>
      <div className={styles.windowHead}>
        <span className={styles.windowLabel}>{labelText(window.label)}</span>
        <span className={styles.windowValue}>{formatPercent(window.remaining)}</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.barFill} ${levelClass(window.remaining)}`}
          style={fillStyle(window.remaining)}
        />
      </div>
      <div className={styles.windowReset}>
        <ResetLine atMs={window.resetAtMs} now={now} />
      </div>
    </div>
  );
}
