/**
 * Notice health (spec rules 4 and 5) as a pure function, plus labels and ordering for chips.
 */
import type { Tone } from '@x10/shared/ui';

import { rules } from '../config';
import type { Ack, AckStatus, ChangeNotice, ChangeType, NoticeStatus } from '../model';
import { daysLabel, daysUntil } from './days';

export const HEALTHS = ['ok', 'waiting', 'at_risk', 'overdue', 'blocked'] as const;
export type Health = (typeof HEALTHS)[number];

export interface HealthResult {
  health: Health;
  /** One line explaining why, for the notice header and tooltips. */
  reason: string;
  /** Set when the result is technically fine but deserves attention (no consumers). */
  warning: string | null;
  /** Whole days from today to the effective date (negative when past). */
  daysLeft: number;
  pending: number;
}

export const NO_CONSUMERS_WARNING =
  'No consumers are registered on this contract, so nobody was asked to acknowledge this change.';

type NoticeLike = Pick<ChangeNotice, 'status' | 'changeType' | 'effectiveDate'>;

const teams = (n: number) => `${n} ${n === 1 ? 'team' : 'teams'}`;

/**
 * Health of one notice given its acks.
 * - blocked: any ack is objected.
 * - ok: every ack is acknowledged or migrated (also when there are no acks: ok with a warning).
 * - overdue: the effective date has passed (yesterday or earlier) and an ack is still pending.
 * - at_risk: a change type in `rules.atRiskTypes` (breaking by default), `rules.atRiskDays` days or fewer to go (today
 *   included), an ack pending.
 * - waiting: everything else. Additive changes are never at_risk, only waiting.
 * A draft has no acks yet; it reports waiting.
 */
export function noticeHealth(
  notice: NoticeLike,
  acks: Pick<Ack, 'status'>[],
  today: string | Date,
  atRiskTypes: readonly ChangeType[] = rules.atRiskTypes,
): HealthResult {
  const daysLeft = daysUntil(notice.effectiveDate, today);
  const pending = acks.filter((a) => a.status === 'pending').length;
  const objected = acks.filter((a) => a.status === 'objected').length;
  const base = { warning: null, daysLeft, pending };

  if (notice.status === 'draft') {
    return { ...base, health: 'waiting', reason: 'Draft: consumers are asked once it is published.' };
  }
  if (acks.length === 0) {
    return { ...base, health: 'ok', reason: 'No consumers to acknowledge.', warning: NO_CONSUMERS_WARNING };
  }
  if (objected > 0) {
    return { ...base, health: 'blocked', reason: `${teams(objected)} objected.` };
  }
  if (pending === 0) {
    return { ...base, health: 'ok', reason: 'Every consumer acknowledged or migrated.' };
  }
  if (daysLeft < 0) {
    return { ...base, health: 'overdue', reason: `Took effect ${daysLabel(daysLeft)}, ${teams(pending)} still pending.` };
  }
  if (atRiskTypes.includes(notice.changeType) && daysLeft <= rules.atRiskDays) {
    return { ...base, health: 'at_risk', reason: `Takes effect ${daysLabel(daysLeft)}, ${teams(pending)} pending.` };
  }
  return { ...base, health: 'waiting', reason: `Takes effect ${daysLabel(daysLeft)}, ${teams(pending)} pending.` };
}

/** Severity order, worst last. */
const severity: Record<Health, number> = { ok: 0, waiting: 1, at_risk: 2, overdue: 3, blocked: 4 };

export function compareHealth(a: Health, b: Health): number {
  return severity[a] - severity[b];
}

/** Worst health of a list, or null for an empty list. */
export function worstHealth(list: Health[]): Health | null {
  return list.reduce<Health | null>((w, h) => (w === null || severity[h] > severity[w] ? h : w), null);
}

/** "Breaking" or "Breaking or deprecation", from `rules.atRiskTypes`. */
export function atRiskTypesLabel(types: readonly ChangeType[] = rules.atRiskTypes): string {
  const text = types.join(' or ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const healthMeta: Record<Health, { label: string; tone: Tone; help: string }> = {
  ok: { label: 'OK', tone: 'ok', help: 'Every consumer acknowledged or migrated.' },
  waiting: { label: 'Waiting', tone: 'info', help: 'Acks are pending but there is still time.' },
  at_risk: {
    label: 'At risk',
    tone: 'warn',
    help: `${atRiskTypesLabel()} change, ${rules.atRiskDays} days or fewer to go, acks still pending.`,
  },
  overdue: { label: 'Overdue', tone: 'bad', help: 'The effective date has passed with acks still pending.' },
  blocked: { label: 'Blocked', tone: 'bad', help: 'A consumer team objected.' },
};

export const ackMeta: Record<AckStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  acknowledged: { label: 'Acknowledged', tone: 'ok' },
  objected: { label: 'Objected', tone: 'bad' },
  migrated: { label: 'Migrated', tone: 'info' },
};

export const changeTypeMeta: Record<ChangeType, { label: string; tone: Tone; help: string }> = {
  additive: { label: 'Additive', tone: 'info', help: 'New columns or values. Existing queries keep working.' },
  breaking: { label: 'Breaking', tone: 'bad', help: 'Renames, type changes or removals. Consumers must change.' },
  deprecation: { label: 'Deprecation', tone: 'warn', help: 'Something is retired on the effective date.' },
};

export const noticeStatusMeta: Record<NoticeStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'brand' },
  closed: { label: 'Closed', tone: 'neutral' },
};
