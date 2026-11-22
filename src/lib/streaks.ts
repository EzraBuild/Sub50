import type { VisitStub } from '../server/accounts/history';

/** All a streak needs from a visit (full sessions and stubs both have it). */
export type Visit = Pick<VisitStub, 'startedAt' | 'endedAt' | 'minutes'>;

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day, "2026-11-23". */
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** The local day after (or before, with -1) a day key. */
export const shiftDay = (key: string, by: number) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d + by).getTime());
};

export interface Rhythm {
  /** Minutes listened per local day. */
  days: Map<string, number>;
  /** Minutes per hour of the day, 0–23. */
  hours: number[];
  /** Minutes per weekday, Monday first. */
  weekdays: number[];
}

/** When you listen: each visit's minutes spread evenly over the local hours it spanned. */
export function rhythm(visits: Visit[]): Rhythm {
  const r: Rhythm = { days: new Map(), hours: Array<number>(24).fill(0), weekdays: Array<number>(7).fill(0) };
  const add = (t: number, minutes: number) => {
    const d = new Date(t);
    const key = dayKey(t);
    r.days.set(key, (r.days.get(key) ?? 0) + minutes);
    r.hours[d.getHours()]! += minutes;
    r.weekdays[(d.getDay() + 6) % 7]! += minutes;
  };
  for (const v of visits) {
    if (!(v.minutes > 0)) continue;
    const span = v.endedAt - v.startedAt;
    if (span <= 0) {
      add(v.startedAt, v.minutes);
      continue;
    }
    for (let t = v.startedAt; t < v.endedAt; ) {
      const next = new Date(t);
      next.setMinutes(60, 0, 0); // the top of the next local hour
      const end = Math.min(v.endedAt, next.getTime());
      add(t, (v.minutes * (end - t)) / span);
      t = end;
    }
  }
  return r;
}

export interface Streaks {
  /** Days in a row up to today (or yesterday: today still has time). */
  current: number;
  longest: number;
  /** Today already counts. */
  today: boolean;
  /** Days with any listening. */
  activeDays: number;
  best: { day: string; minutes: number } | null;
  /** The days of the current streak. */
  streakDays: Set<string>;
}

export function streaks(days: Map<string, number>, now = Date.now()): Streaks {
  const active = [...days].filter(([, m]) => m > 0);
  const on = new Set(active.map(([d]) => d));
  const today = dayKey(now);
  const streakDays = new Set<string>();
  for (let d = on.has(today) ? today : shiftDay(today, -1); on.has(d); d = shiftDay(d, -1)) streakDays.add(d);

  let longest = 0;
  for (const d of on) {
    if (on.has(shiftDay(d, -1))) continue; // not the start of a run
    let n = 1;
    while (on.has(shiftDay(d, n))) n++;
    longest = Math.max(longest, n);
  }
  const best = active.reduce<Streaks['best']>((b, [day, minutes]) => (!b || minutes > b.minutes ? { day, minutes } : b), null);
  return { current: streakDays.size, longest, today: on.has(today), activeDays: on.size, best, streakDays };
}

/** LED height for a day: 0 (none) to 5 (two hours or more). */
export function level(minutes: number): number {
  if (!(minutes > 0)) return 0;
  return minutes < 15 ? 1 : minutes < 30 ? 2 : minutes < 60 ? 3 : minutes < 120 ? 4 : 5;
}

export interface MonthRow {
  /** "2026-11" */
  key: string;
  /** Day keys, 1st to last. */
  days: string[];
}

/** The months from the first one with listening (at least `min`, at most `max`) up to now, newest first. */
export function monthRows(days: Map<string, number>, now = Date.now(), min = 3, max = 12): MonthRow[] {
  const first = [...days.keys()].sort()[0];
  const end = new Date(now);
  const start = first ? new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1) : end;
  const span = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
  const count = Math.min(max, Math.max(min, span));
  const rows: MonthRow[] = [];
  for (let i = 0; i < count; i++) {
    const y = end.getFullYear();
    const m = end.getMonth() - i;
    const length = new Date(y, m + 1, 0).getDate();
    const first = new Date(y, m, 1);
    rows.push({ key: `${first.getFullYear()}-${pad(first.getMonth() + 1)}`, days: Array.from({ length }, (_, d) => dayKey(new Date(y, m, d + 1).getTime())) });
  }
  return rows;
}

const PARTS = [
  { name: 'mornings', from: 5, to: 11 },
  { name: 'afternoons', from: 11, to: 17 },
  { name: 'evenings', from: 17, to: 22 },
  { name: 'late nights', from: 22, to: 29 },
] as const;

/** "late nights", from the hours you listen most; null with nothing yet. */
export function partOfDay(hours: number[]): string | null {
  let best: string | null = null;
  let most = 0;
  for (const p of PARTS) {
    let sum = 0;
    for (let h = p.from; h < p.to; h++) sum += hours[h % 24] ?? 0;
    if (sum > most) [best, most] = [p.name, sum];
  }
  return best;
}
