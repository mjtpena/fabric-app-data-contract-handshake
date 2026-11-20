/**
 * The transit vocabulary in one place: signal colours, board remarks, line status, change-type and departure colours,
 * and the lens definitions. Health words stay the domain's (blocked, overdue, at risk, waiting, OK); the metaphor
 * words sit beside them, never instead of them.
 */
import type { LegendItem, LensOption, Tone } from '@x10/shared/ui';

import type { Health } from '../domain/health';
import type { ChangeType } from '../model';
import type { LensKey, Network, Signal } from './network';

export const signalMeta: Record<Signal, { label: string; color: string; tone: Tone }> = {
  acknowledged: { label: 'Acknowledged', color: 'var(--ok-solid)', tone: 'ok' },
  migrated: { label: 'Migrated', color: 'var(--info-solid)', tone: 'info' },
  pending: { label: 'Pending', color: 'var(--warn-solid)', tone: 'warn' },
  objected: { label: 'Objected', color: 'var(--bad-solid)', tone: 'bad' },
  none: { label: 'No open service', color: 'var(--gray-8)', tone: 'neutral' },
};

/** Board remark (services) and line status (lines) for each health. */
export const remarkMeta: Record<Health, { board: string; line: string; tone: Tone; color: string; boardColor: string }> = {
  ok: { board: 'CLEARED', line: 'Good service', tone: 'ok', color: 'var(--ok-solid)', boardColor: 'var(--board-ok)' },
  waiting: { board: 'ON TIME', line: 'Change scheduled', tone: 'info', color: 'var(--info-solid)', boardColor: 'var(--board-info)' },
  at_risk: { board: 'FINAL CALL', line: 'Final call', tone: 'warn', color: 'var(--warn-solid)', boardColor: 'var(--board-warn)' },
  overdue: { board: 'DELAYED', line: 'Delays', tone: 'bad', color: 'var(--bad-solid)', boardColor: 'var(--board-bad)' },
  blocked: { board: 'HELD', line: 'Held at a signal', tone: 'bad', color: 'var(--bad-solid)', boardColor: 'var(--board-bad)' },
};

export const typeColor: Record<ChangeType, string> = {
  breaking: 'var(--bad-solid)',
  deprecation: 'var(--warn-solid)',
  additive: 'var(--info-solid)',
};

export const typeShort: Record<ChangeType, string> = { breaking: 'BRK', deprecation: 'DEP', additive: 'ADD' };

/** Days to departure → colour: late, inside a week, inside three weeks, later. */
export function departureColor(days: number): string {
  if (days < 0) return 'var(--bad-solid)';
  if (days <= 7) return 'var(--warn-solid)';
  if (days <= 21) return 'var(--info-solid)';
  return 'var(--gray-9)';
}

/** "27 NOV": a calendar day (stored as UTC midnight) for the flaps. */
export function dayFlap(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-- ---';
  const mon = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(d).toUpperCase();
  return `${String(d.getUTCDate()).padStart(2, '0')} ${mon}`;
}

/** "T-5", "T-0", "T+3": a departure countdown. */
export function countdown(days: number): string {
  return days > 0 ? `T-${days}` : days === 0 ? 'T-0' : `T+${-days}`;
}

export const LENSES: LensOption<LensKey>[] = [
  {
    value: 'signal',
    label: 'Signals',
    swatch: 'conic-gradient(var(--ok-solid) 0 40%, var(--warn-solid) 0 75%, var(--bad-solid) 0)',
    description: 'How each station answered the open services',
  },
  {
    value: 'type',
    label: 'Type',
    swatch: 'linear-gradient(90deg, var(--bad-solid), var(--warn-solid), var(--info-solid))',
    description: 'Breaking, deprecation or additive',
  },
  {
    value: 'departure',
    label: 'Departs',
    swatch: 'linear-gradient(90deg, var(--bad-solid), var(--warn-solid), var(--gray-8))',
    description: 'Days until each service departs',
  },
  {
    value: 'team',
    label: 'Teams',
    swatch: 'var(--accent-9)',
    description: 'Signals each consumer team still has to answer',
  },
];

export function legendFor(lens: LensKey, net: Network): { title: string; items: LegendItem[] } {
  if (lens === 'signal') {
    const stops = net.lines.flatMap((l) => l.stops);
    const n = (s: Signal) => stops.filter((x) => x.signal === s).length;
    return {
      title: 'Signal at each stop',
      items: (['acknowledged', 'migrated', 'pending', 'objected', 'none'] as Signal[]).map((s) => ({
        label: signalMeta[s].label,
        color: signalMeta[s].color,
        value: n(s),
      })),
    };
  }
  if (lens === 'type') {
    const n = (t: ChangeType) => net.services.filter((s) => s.notice.changeType === t).length;
    return {
      title: 'Change type',
      items: [
        { label: 'Breaking', color: typeColor.breaking, shape: 'line', value: n('breaking') },
        { label: 'Deprecation', color: typeColor.deprecation, shape: 'line', value: n('deprecation') },
        { label: 'Additive', color: typeColor.additive, shape: 'line', value: n('additive') },
        { label: 'No open change', color: 'var(--gray-7)', shape: 'line' },
      ],
    };
  }
  if (lens === 'departure') {
    const d = net.services.map((s) => s.health.daysLeft);
    return {
      title: 'Departs',
      items: [
        { label: 'Left late', color: departureColor(-1), shape: 'square', value: d.filter((x) => x < 0).length },
        { label: 'Within 7 days', color: departureColor(3), shape: 'square', value: d.filter((x) => x >= 0 && x <= 7).length },
        { label: '8 to 21 days', color: departureColor(14), shape: 'square', value: d.filter((x) => x > 7 && x <= 21).length },
        { label: 'Later', color: departureColor(30), shape: 'square', value: d.filter((x) => x > 21).length },
      ],
    };
  }
  return {
    title: 'Signals to answer',
    items: [
      { label: 'Pending at a station', color: 'var(--accent-9)', shape: 'ring', value: net.stations.reduce((n, s) => n + s.pending, 0) },
      { label: 'Interchange', color: 'var(--gray-11)', shape: 'ring', value: net.stations.filter((s) => s.lineIds.length > 1).length },
      { label: 'Line, one per contract', color: 'var(--gray-9)', shape: 'line', value: net.lines.length },
    ],
  };
}
