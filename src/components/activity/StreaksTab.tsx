import { useMemo, useState, type ReactNode } from 'react';
import { formatMinutes } from '../../lib/activity';
import { dayKey, level, monthRows, partOfDay, shiftDay, streaks, type Rhythm } from '../../lib/streaks';
import { STAT_GRID, Stat } from './RoomsTab';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LEDS = 5;
const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d ?? 1);
};
const longDay = (key: string) => dateOf(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const hourRange = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
/** Lit LED / bar colors: the story (current streak, the peak) in brand, the rest a recessive gray. */
const LIT = 'bg-faint dark:bg-muted';

type Show = (el: Element, value: string, label: string) => void;
interface Tip {
  value: string;
  label: string;
  x: number;
  y: number;
}

function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="label">{label}</p>
        {aside && <p className="font-mono text-[11px] text-faint">{aside}</p>}
      </div>
      {children}
    </section>
  );
}

/** One row per month; each day a column of LEDs, taller the longer you listened. */
function MonthMeter({ days, streak, today, show, hide }: { days: Map<string, number>; streak: Set<string>; today: string; show: Show; hide: () => void }) {
  const rows = monthRows(days);
  const thisYear = today.slice(0, 4);
  return (
    <div className="mt-4 space-y-3">
      {rows.map((row) => {
        const listened = row.days.filter((d) => (days.get(d) ?? 0) > 0);
        const total = listened.reduce((sum, d) => sum + days.get(d)!, 0);
        const first = dateOf(row.key);
        const name = first.toLocaleDateString([], { month: 'short', ...(row.key.slice(0, 4) !== thisYear ? { year: '2-digit' } : {}) });
        return (
          <div key={row.key} className="flex items-end gap-3">
            <div className="w-12 shrink-0 pb-0.5">
              <p className="font-mono text-[11px] text-ink-2 uppercase">{name}</p>
              <p className="font-mono text-[10px] text-faint">{listened.length}d</p>
            </div>
            <div
              role="img"
              aria-label={`${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}: listened ${listened.length} days, ${listened.length ? formatMinutes(total) : 'nothing'}`}
              className="grid max-w-[420px] min-w-0 flex-1 grid-cols-[repeat(31,minmax(0,1fr))] gap-[2px]"
            >
              {row.days.map((day) => {
                const minutes = days.get(day) ?? 0;
                const lit = level(minutes);
                return (
                  <div
                    key={day}
                    className="relative flex flex-col-reverse gap-[2px] pb-1.5"
                    onPointerEnter={(e) => day <= today && show(e.currentTarget, minutes > 0 ? formatMinutes(minutes) : 'nothing', longDay(day))}
                    onPointerLeave={hide}
                  >
                    {day <= today &&
                      Array.from({ length: LEDS }, (_, i) => (
                        <span key={i} className={`aspect-square w-full rounded-full ${i < lit ? (streak.has(day) ? 'bg-brand' : LIT) : 'bg-line'}`} />
                      ))}
                    {day === today && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink" />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 24 bars around a dial, midnight at the top. */
function ListeningClock({ hours, show, hide }: { hours: number[]; show: Show; hide: () => void }) {
  const max = Math.max(...hours);
  const peak = hours.indexOf(max);
  const [inner, reach] = [38, 50];
  const at = (h: number, r: number) => {
    const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
    return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const;
  };
  return (
    <svg viewBox="-12 -12 224 224" className="mx-auto mt-3 block w-full max-w-[240px]" role="img" aria-label={`Listening by hour of the day; most at ${hourRange(peak)}`}>
      <circle cx="100" cy="100" r={inner - 4} className="fill-none stroke-line" strokeWidth="1" />
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = at(h, inner + reach + 12);
        return (
          <text key={h} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-faint font-mono text-[9px]">
            {String(h).padStart(2, '0')}
          </text>
        );
      })}
      {hours.map((m, h) => {
        const [x1, y1] = at(h + 0.5, inner);
        const [x2, y2] = at(h + 0.5, inner + (max > 0 ? (m / max) * reach : 0));
        const [hx, hy] = at(h + 0.5, inner + reach);
        return (
          <g key={h} onPointerEnter={(e) => show(e.currentTarget, m > 0 ? formatMinutes(m) : 'nothing', hourRange(h))} onPointerLeave={hide}>
            <line x1={x1} y1={y1} x2={hx} y2={hy} stroke="transparent" strokeWidth="14" />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth="6"
              strokeLinecap="round"
              className={m <= 0 ? 'stroke-line' : h === peak ? 'stroke-brand' : 'stroke-faint dark:stroke-muted'}
            />
          </g>
        );
      })}
      <text x="100" y="94" textAnchor="middle" className="fill-faint font-mono text-[9px] uppercase">
        peak
      </text>
      <text x="100" y="111" textAnchor="middle" className="fill-ink text-[15px] font-semibold">
        {max > 0 ? `${String(peak).padStart(2, '0')}:00` : '—'}
      </text>
    </svg>
  );
}

/** Minutes per weekday, Monday first; the loudest one in brand, labeled. */
function WeekBars({ weekdays, show, hide }: { weekdays: number[]; show: Show; hide: () => void }) {
  const max = Math.max(...weekdays);
  const peak = weekdays.indexOf(max);
  return (
    <div className="mx-auto mt-3 flex h-[180px] max-w-[300px] items-end justify-between gap-2" role="img" aria-label={`Listening by weekday; most on ${WEEKDAYS[peak]}s`}>
      {weekdays.map((m, i) => (
        <div
          key={WEEKDAYS[i]}
          className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          onPointerEnter={(e) => show(e.currentTarget, m > 0 ? formatMinutes(m) : 'nothing', `${WEEKDAYS[i]}s`)}
          onPointerLeave={hide}
        >
          {i === peak && max > 0 && <span className="font-mono text-[10px] whitespace-nowrap text-ink-2">{formatMinutes(m)}</span>}
          <span
            className={`w-full max-w-6 rounded-t-[4px] ${m <= 0 ? 'bg-line' : i === peak ? 'bg-brand' : LIT}`}
            style={{ height: `${max > 0 ? Math.max(2, (m / max) * 120) : 2}px` }}
          />
          <span className={`font-mono text-[10px] ${i === peak && max > 0 ? 'text-ink' : 'text-faint'}`}>{WEEKDAYS[i]!.slice(0, 2)}</span>
        </div>
      ))}
    </div>
  );
}

/** Your streak, a month-by-month level meter, and when in the day and week you listen. */
export function StreaksTab({ rhythm, totalMinutes }: { rhythm: Rhythm; totalMinutes: number }) {
  const today = dayKey(Date.now());
  const s = useMemo(() => streaks(rhythm.days), [rhythm]);
  const [tip, setTip] = useState<Tip | null>(null);
  const show: Show = (el, value, label) => {
    const r = el.getBoundingClientRect();
    setTip({ value, label, x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setTip(null);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6));
  const part = partOfDay(rhythm.hours);
  const loudest = rhythm.weekdays.indexOf(Math.max(...rhythm.weekdays));

  const status = s.today
    ? `Today counts. Come back tomorrow to make it ${s.current + 1}.`
    : s.current > 0
      ? 'Listen for a minute today to keep it going.'
      : 'Listen for a minute today to start one.';

  return (
    <div className="divide-y divide-line">
      <section className="px-4 pt-7 pb-6 sm:px-6">
        <p className="label">current streak</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <p className="flex items-baseline gap-2">
            <span className="text-[64px] leading-[0.9] font-semibold tracking-[-0.04em] text-ink">{s.current}</span>
            <span className="text-[18px] font-medium text-muted">{s.current === 1 ? 'day' : 'days'}</span>
          </p>
          <ol className="flex gap-2.5" aria-label="The last seven days">
            {week.map((d) => (
              <li key={d} className="flex flex-col items-center gap-1.5" aria-label={`${longDay(d)}: ${(rhythm.days.get(d) ?? 0) > 0 ? 'listened' : 'no listening'}`}>
                <span className={`size-3 rounded-full ${s.streakDays.has(d) ? 'bg-brand' : (rhythm.days.get(d) ?? 0) > 0 ? LIT : 'bg-line'}`} />
                <span className={`font-mono text-[10px] ${d === today ? 'text-ink' : 'text-faint'}`}>{dateOf(d).toLocaleDateString([], { weekday: 'narrow' })}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-4 text-[13px] text-muted">{status}</p>
      </section>

      <div className={STAT_GRID}>
        <Stat label="longest" value={`${s.longest} ${s.longest === 1 ? 'day' : 'days'}`} hint="Your longest run of days in a row" />
        <Stat label="days" value={String(s.activeDays)} hint="Days you listened" />
        <Stat label="best day" value={s.best ? formatMinutes(s.best.minutes) : '—'} hint={s.best ? longDay(s.best.day) : 'Nothing yet'} />
        <Stat label="listened" value={formatMinutes(totalMinutes)} hint="All time, older visits included" />
      </div>

      <Section label="level meter" aside="a column a day · taller = longer · green = this streak">
        <MonthMeter days={rhythm.days} streak={s.streakDays} today={today} show={show} hide={hide} />
      </Section>

      <div className="grid divide-line max-sm:divide-y sm:grid-cols-2 sm:divide-x">
        <Section label="listening clock" aside={part ? `mostly ${part}` : undefined}>
          <ListeningClock hours={rhythm.hours} show={show} hide={hide} />
        </Section>
        <Section label="week" aside={Math.max(...rhythm.weekdays) > 0 ? `loudest on ${WEEKDAYS[loudest]}s` : undefined}>
          <WeekBars weekdays={rhythm.weekdays} show={show} hide={hide} />
        </Section>
      </div>

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-panel px-2 py-1 font-mono text-[11px] whitespace-nowrap text-muted shadow-lg"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          <strong className="font-semibold text-ink">{tip.value}</strong> · {tip.label}
        </div>
      )}
    </div>
  );
}
