/**
 * Calendar-day helpers. An effective date is a calendar day, stored as UTC midnight of that day
 * ("2026-11-27T00:00:00.000Z"), so it never shifts with the viewer's time zone. "Today" is the viewer's local
 * calendar date expressed the same way, so day differences are whole numbers.
 */
import { DAY, utcDay } from '@x10/shared/lib';

/** UTC midnight (ISO) of the local calendar date of `now`. */
export function localToday(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();
}

/** Shift a day ISO string by whole days. */
export function shiftDays(dayIso: string, days: number): string {
  return new Date(utcDay(dayIso) + days * DAY).toISOString();
}

/** Whole days from `today` to `day` (negative when `day` is in the past). A Date is read as its local calendar day. */
export function daysUntil(day: string, today: string | Date): number {
  const t = today instanceof Date ? localToday(today) : today;
  return Math.round((utcDay(day) - utcDay(t)) / DAY);
}

/** "2026-11-27" (for <input type="date">) from a stored day ISO string. */
export function toDayInput(dayIso: string | null | undefined): string {
  if (!dayIso) return '';
  const d = new Date(dayIso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Stored day ISO string from an <input type="date"> value; null when empty or invalid. */
export function fromDayInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d.toISOString();
}

/** "27 Nov 2026" in the viewer's locale, without time-zone shifting. */
export function formatDay(dayIso: string | null | undefined): string {
  if (!dayIso) return '—';
  const d = new Date(dayIso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function daysLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
