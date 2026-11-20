import { daysLabel, daysUntil, formatDay, fromDayInput, localToday, shiftDays, toDayInput } from './days';

describe('day helpers', () => {
  it('localToday is UTC midnight of the local calendar date', () => {
    expect(localToday(new Date(2026, 10, 20, 23, 59))).toBe('2026-11-20T00:00:00.000Z');
    expect(localToday(new Date(2026, 10, 20, 0, 1))).toBe('2026-11-20T00:00:00.000Z');
  });

  it('shiftDays and daysUntil agree', () => {
    const t = '2026-11-20T00:00:00.000Z';
    expect(shiftDays(t, 7)).toBe('2026-11-27T00:00:00.000Z');
    expect(daysUntil(shiftDays(t, 7), t)).toBe(7);
    expect(daysUntil(shiftDays(t, -1), t)).toBe(-1);
    expect(daysUntil(t, t)).toBe(0);
  });

  it('round-trips date inputs and rejects bad ones', () => {
    expect(fromDayInput('2026-12-01')).toBe('2026-12-01T00:00:00.000Z');
    expect(toDayInput('2026-12-01T00:00:00.000Z')).toBe('2026-12-01');
    expect(fromDayInput('')).toBeNull();
    expect(fromDayInput('2026-02-31')).toBeNull();
    expect(fromDayInput('12/01/2026')).toBeNull();
    expect(toDayInput(null)).toBe('');
  });

  it('labels relative days', () => {
    expect(daysLabel(0)).toBe('today');
    expect(daysLabel(1)).toBe('tomorrow');
    expect(daysLabel(-1)).toBe('yesterday');
    expect(daysLabel(5)).toBe('in 5 days');
    expect(daysLabel(-3)).toBe('3 days ago');
  });

  it('formats a day without shifting it', () => {
    expect(formatDay('2026-12-01T00:00:00.000Z')).toMatch(/1/);
    expect(formatDay(null)).toBe('—');
  });
});
