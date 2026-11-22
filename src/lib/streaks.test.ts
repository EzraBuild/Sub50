import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, level, monthRows, partOfDay, rhythm, shiftDay, streaks } from './streaks';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const visit = (start: number, minutes: number, spanMin = minutes) => ({ startedAt: start, endedAt: start + spanMin * 60_000, minutes });

test('day keys are local and shift across months and years', () => {
  assert.equal(dayKey(at(2026, 3, 9, 23, 59)), '2026-03-09');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('a visit over midnight splits its minutes between the two days and their hours', () => {
  const r = rhythm([visit(at(2026, 11, 20, 23, 30), 60)]);
  assert.deepEqual([...r.days], [['2026-11-20', 30], ['2026-11-21', 30]]);
  assert.equal(r.hours[23], 30);
  assert.equal(r.hours[0], 30);
  assert.equal(r.weekdays[4], 30, 'Friday');
  assert.equal(r.weekdays[5], 30, 'Saturday');
});

test('minutes are spread by the share of time, not wall-clock (paused time counts less)', () => {
  const r = rhythm([visit(at(2026, 11, 20, 10, 0), 30, 120)]); // 30 min of music over two hours
  assert.deepEqual([r.hours[10], r.hours[11]], [15, 15]);
});

test('streaks: current runs through yesterday until today ends; longest anywhere', () => {
  const days = new Map([
    ['2026-11-01', 10], ['2026-11-02', 5], ['2026-11-03', 40], ['2026-11-04', 1], // 4 in a row
    ['2026-11-20', 30], ['2026-11-21', 90], ['2026-11-22', 20],
  ]);
  const notYet = streaks(days, at(2026, 11, 23, 9));
  assert.deepEqual([notYet.current, notYet.today, notYet.longest, notYet.activeDays], [3, false, 4, 7]);
  assert.deepEqual(notYet.best, { day: '2026-11-21', minutes: 90 });
  assert.deepEqual([...notYet.streakDays].sort(), ['2026-11-20', '2026-11-21', '2026-11-22']);
  days.set('2026-11-23', 12);
  assert.deepEqual([streaks(days, at(2026, 11, 23, 9)).current, streaks(days, at(2026, 11, 23, 9)).longest], [4, 4]);
  assert.equal(streaks(days, at(2026, 11, 25, 9)).current, 0, 'missed a day');
  assert.deepEqual(streaks(new Map(), at(2026, 11, 25)), { current: 0, longest: 0, today: false, activeDays: 0, best: null, streakDays: new Set() });
});

test('LED levels', () => {
  assert.deepEqual([0, 3, 15, 30, 60, 119, 120, 600].map(level), [0, 1, 2, 3, 4, 4, 5, 5]);
});

test('month rows: from the first listening month (3 to 12 of them), newest first, every day', () => {
  const now = at(2026, 3, 9);
  const rows = monthRows(new Map([['2025-11-05', 10]]), now);
  assert.deepEqual(rows.map((r) => r.key), ['2026-03', '2026-02', '2026-01', '2025-12', '2025-11']);
  assert.equal(rows[1]!.days.length, 28);
  assert.equal(rows[1]!.days[27], '2026-02-28');
  assert.equal(monthRows(new Map(), now).length, 3, 'at least three');
  assert.equal(monthRows(new Map([['2020-01-01', 1]]), now).length, 12, 'at most a year');
});

test('part of day you listen most', () => {
  const hours = Array(24).fill(0);
  assert.equal(partOfDay(hours), null);
  hours[23] = 20;
  hours[1] = 20;
  hours[18] = 30;
  assert.equal(partOfDay(hours), 'late nights', 'wraps past midnight');
});
