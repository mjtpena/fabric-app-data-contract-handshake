import type { AckStatus, ChangeNotice, ChangeType, NoticeStatus } from '../model';
import { shiftDays } from './days';
import { rules } from '../config';
import { atRiskTypesLabel, compareHealth, noticeHealth, NO_CONSUMERS_WARNING, worstHealth } from './health';

const TODAY = '2026-11-20T00:00:00.000Z';

function notice(changeType: ChangeType, inDays: number, status: NoticeStatus = 'published'): Pick<ChangeNotice, 'status' | 'changeType' | 'effectiveDate'> {
  return { changeType, status, effectiveDate: shiftDays(TODAY, inDays) };
}
const acks = (...s: AckStatus[]) => s.map((status) => ({ status }));

describe('noticeHealth', () => {
  it('ok when every ack is acknowledged or migrated', () => {
    const r = noticeHealth(notice('breaking', 2), acks('acknowledged', 'migrated'), TODAY);
    expect(r.health).toBe('ok');
    expect(r.warning).toBeNull();
  });

  it('ok even after the effective date when nothing is pending', () => {
    expect(noticeHealth(notice('breaking', -5), acks('acknowledged'), TODAY).health).toBe('ok');
  });

  it('no consumers: ok with a warning', () => {
    const r = noticeHealth(notice('breaking', 1), [], TODAY);
    expect(r.health).toBe('ok');
    expect(r.warning).toBe(NO_CONSUMERS_WARNING);
  });

  it('blocked when any ack is objected, ahead of overdue and at risk', () => {
    expect(noticeHealth(notice('additive', 30), acks('objected', 'acknowledged'), TODAY).health).toBe('blocked');
    expect(noticeHealth(notice('breaking', -3), acks('objected', 'pending'), TODAY).health).toBe('blocked');
    expect(noticeHealth(notice('breaking', 2), acks('objected', 'pending'), TODAY).health).toBe('blocked');
  });

  it('overdue when the effective date passed (yesterday) and an ack is pending', () => {
    const r = noticeHealth(notice('breaking', -1), acks('pending', 'acknowledged'), TODAY);
    expect(r.health).toBe('overdue');
    expect(r.daysLeft).toBe(-1);
    expect(r.pending).toBe(1);
  });

  it('additive changes can still be overdue', () => {
    expect(noticeHealth(notice('additive', -1), acks('pending'), TODAY).health).toBe('overdue');
  });

  it('effective today is not overdue: breaking pending is at risk', () => {
    const r = noticeHealth(notice('breaking', 0), acks('pending'), TODAY);
    expect(r.health).toBe('at_risk');
    expect(r.daysLeft).toBe(0);
  });

  it('breaking exactly 7 days out with a pending ack is at risk', () => {
    expect(noticeHealth(notice('breaking', 7), acks('pending', 'acknowledged'), TODAY).health).toBe('at_risk');
  });

  it('breaking 8 days out is waiting', () => {
    expect(noticeHealth(notice('breaking', 8), acks('pending'), TODAY).health).toBe('waiting');
  });

  it('by default (spec rule 4) only breaking changes turn at risk: a deprecation 2 days out is waiting', () => {
    expect(rules.atRiskTypes).toEqual(['breaking']);
    expect(noticeHealth(notice('deprecation', 2), acks('pending'), TODAY).health).toBe('waiting');
    expect(noticeHealth(notice('deprecation', -1), acks('pending'), TODAY).health).toBe('overdue');
  });

  it('the atRiskTypes switch can include deprecations (same 7-day boundary)', () => {
    const both = ['breaking', 'deprecation'] as const;
    expect(noticeHealth(notice('deprecation', 7), acks('pending'), TODAY, both).health).toBe('at_risk');
    expect(noticeHealth(notice('deprecation', 8), acks('pending'), TODAY, both).health).toBe('waiting');
    expect(noticeHealth(notice('additive', 1), acks('pending'), TODAY, both).health).toBe('waiting');
  });

  it('additive is never at risk, only waiting (today, 1 day, 7 days)', () => {
    for (const d of [0, 1, 7]) {
      expect(noticeHealth(notice('additive', d), acks('pending'), TODAY).health).toBe('waiting');
    }
  });

  it('draft reports waiting', () => {
    expect(noticeHealth(notice('breaking', -4, 'draft'), [], TODAY).health).toBe('waiting');
  });

  it('closed notices are assessed on their acks', () => {
    expect(noticeHealth(notice('breaking', -40, 'closed'), acks('migrated'), TODAY).health).toBe('ok');
  });

  it('accepts a Date for today and uses its local calendar day', () => {
    const local = new Date(2026, 10, 20, 23, 30);
    expect(noticeHealth(notice('breaking', 0), acks('pending'), local).daysLeft).toBe(0);
  });
});

describe('health ordering', () => {
  it('atRiskTypesLabel reads the configured types', () => {
    expect(atRiskTypesLabel(['breaking'])).toBe('Breaking');
    expect(atRiskTypesLabel(['breaking', 'deprecation'])).toBe('Breaking or deprecation');
  });

  it('worstHealth picks the most severe, null for none', () => {
    expect(worstHealth([])).toBeNull();
    expect(worstHealth(['ok', 'waiting'])).toBe('waiting');
    expect(worstHealth(['at_risk', 'overdue', 'waiting'])).toBe('overdue');
    expect(worstHealth(['overdue', 'blocked', 'ok'])).toBe('blocked');
  });

  it('compareHealth sorts ok < waiting < at_risk < overdue < blocked', () => {
    const sorted = (['blocked', 'ok', 'overdue', 'waiting', 'at_risk'] as const).slice().sort(compareHealth);
    expect(sorted).toEqual(['ok', 'waiting', 'at_risk', 'overdue', 'blocked']);
  });
});
