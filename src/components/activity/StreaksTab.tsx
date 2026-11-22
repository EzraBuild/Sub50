import { useMemo, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { formatMinutes } from '../../lib/activity';
import { dayKey, level, monthRows, partOfDay, shiftDay, streaks, type Rhythm, type Streaks } from '../../lib/streaks';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d ?? 1);
};
const longDay = (key: string) => dateOf(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const hourRange = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
/** Bars that aren't the story: a recessive gray (validated against brand in both themes). */
const LIT = 'bg-faint dark:bg-muted';
/** Sequential, one hue: brighter = longer. Level 1–5 → opacity of brand over the groove. */
const SHADE = [0.3, 0.48, 0.66, 0.83, 1];

type Show = (el: Element, value: string, label: string) => void;
interface Tip {
  value: string;
  label: string;
  x: number;
  y: number;
}
/** Hover on a mouse, tap on touch (a tap's pointerleave would hide it at once). */
const hoverProps = (show: (el: Element) => void, hide: () => void) => ({
  onPointerEnter: (e: PointerEvent<Element>) => e.pointerType === 'mouse' && show(e.currentTarget),
  onPointerLeave: (e: PointerEvent<Element>) => e.pointerType === 'mouse' && hide(),
  onClick: (e: MouseEvent<Element>) => {
    e.stopPropagation();
    show(e.currentTarget);
  },
});

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

// Record geometry (SVG units, centered on 0,0).
const DISC = 156;
const OUTER = 147;
const INNER = 60;
const TOP_GAP = 26; // degrees left open at 12 o'clock for the month names
const SLOT = (360 - TOP_GAP) / 31; // day 1 always at the same angle, so months line up
const point = (r: number, deg: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)] as const;
const slice = (r0: number, r1: number, a0: number, a1: number) => {
  const [x0, y0] = point(r1, a0);
  const [x1, y1] = point(r1, a1);
  const [x2, y2] = point(r0, a1);
  const [x3, y3] = point(r0, a0);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
};

/** Your year as a vinyl record: a groove per month (this one outside), a slice per day. */
function VinylYear({ days, today, s, show, hide }: { days: Map<string, number>; today: string; s: Streaks; show: Show; hide: () => void }) {
  const rows = monthRows(days);
  const pitch = (OUTER - INNER) / rows.length;
  const thick = Math.max(3, pitch - 2);
  const label = Math.min(8, pitch * 0.95);
  const listenedIn = rows.reduce((n, r) => n + r.days.filter((d) => (days.get(d) ?? 0) > 0).length, 0);
  const todayAt = TOP_GAP / 2 + (Number(today.slice(8)) - 0.5) * SLOT;
  const [tx, ty] = point(OUTER + 4.5, todayAt);
  return (
    <svg
      viewBox={`${-DISC - 2} ${-DISC - 2} ${2 * DISC + 4} ${2 * DISC + 4}`}
      className="mx-auto block w-full max-w-[340px]"
      role="img"
      aria-label={`Your listening as a record, one groove per month with this month outside: ${listenedIn} days in the last ${rows.length} months. Current streak ${s.current} days.`}
    >
      <circle r={DISC} className="fill-sunken stroke-line" strokeWidth="1" />
      {rows.map((row, i) => {
        const r1 = OUTER - i * pitch;
        const r0 = r1 - thick;
        const pad = ((1.2 / ((r0 + r1) / 2)) * 180) / Math.PI;
        const first = dateOf(row.key);
        const listened = row.days.filter((d) => (days.get(d) ?? 0) > 0);
        return (
          <g key={row.key}>
            <title>{`${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}: ${listened.length} days, ${formatMinutes(listened.reduce((n, d) => n + days.get(d)!, 0))}`}</title>
            <text x="0" y={-(r0 + r1) / 2} textAnchor="middle" dominantBaseline="central" className="fill-faint font-mono" fontSize={label}>
              {first.toLocaleDateString([], { month: 'short' }).toUpperCase()}
            </text>
            {row.days.map((day, d) => {
              if (day > today) return null;
              const minutes = days.get(day) ?? 0;
              const lit = level(minutes);
              const a0 = TOP_GAP / 2 + d * SLOT + pad;
              return (
                <path
                  key={day}
                  d={slice(r0, r1, a0, a0 + SLOT - 2 * pad)}
                  className={lit ? 'fill-brand' : 'fill-line'}
                  fillOpacity={lit ? SHADE[lit - 1] : 1}
                  {...hoverProps((el) => show(el, minutes > 0 ? formatMinutes(minutes) : 'nothing', longDay(day)), hide)}
                />
              );
            })}
          </g>
        );
      })}
      <circle cx={tx} cy={ty} r="2.6" className="fill-ink" />
      <circle r={INNER - 7} className="fill-canvas stroke-line" strokeWidth="1" />
      <text y="5" textAnchor="middle" className="fill-ink font-semibold" fontSize="34" letterSpacing="-1.5">
        {s.current}
      </text>
      <text y="24" textAnchor="middle" className="fill-muted font-mono uppercase" fontSize="7.5" letterSpacing="0.6">
        day streak
      </text>
    </svg>
  );
}

/** 24 bars around a dial, midnight at the top. */
function ListeningClock({ hours, show, hide }: { hours: number[]; show: Show; hide: () => void }) {
  const max = Math.max(...hours);
  const peak = hours.indexOf(max);
  const [inner, reach] = [38, 50];
  const at = (h: number, r: number) => point(r, (h / 24) * 360);
  return (
    <svg viewBox="-112 -112 224 224" className="mx-auto mt-3 block w-full max-w-[240px]" role="img" aria-label={`Listening by hour of the day; most at ${hourRange(peak)}`}>
      <circle r={inner - 4} className="fill-none stroke-line" strokeWidth="1" />
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
          <g key={h} {...hoverProps((el) => show(el, m > 0 ? formatMinutes(m) : 'nothing', hourRange(h)), hide)}>
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
      <text y="-6" textAnchor="middle" className="fill-faint font-mono text-[9px] uppercase">
        peak
      </text>
      <text y="11" textAnchor="middle" className="fill-ink text-[15px] font-semibold">
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
          {...hoverProps((el) => show(el, m > 0 ? formatMinutes(m) : 'nothing', `${WEEKDAYS[i]}s`), hide)}
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

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink">{value}</dd>
      {hint && <dd className="font-mono text-[10.5px] text-faint">{hint}</dd>}
    </div>
  );
}

/** Your streak on a record of the year, plus when in the day and week you listen. */
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
    <div className="divide-y divide-line" onClick={hide}>
      <section className="grid items-center gap-x-10 gap-y-7 px-4 py-7 sm:grid-cols-[minmax(0,340px)_1fr] sm:px-6">
        <figure>
          <VinylYear days={rhythm.days} today={today} s={s} show={show} hide={hide} />
          <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-mono text-[10.5px] text-faint">
            <span>outside = this month · inward = earlier</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-ink" /> today
            </span>
            <span className="flex items-center gap-1">
              less
              <span className="size-2 rounded-[2px] bg-line" />
              {SHADE.map((o) => (
                <span key={o} className="size-2 rounded-[2px] bg-brand" style={{ opacity: o }} />
              ))}
              more
            </span>
          </figcaption>
        </figure>

        <div>
          <p className="label">current streak</p>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">{status}</p>
          <ol className="mt-4 flex gap-3" aria-label="The last seven days">
            {week.map((d) => (
              <li key={d} className="flex flex-col items-center gap-1.5" aria-label={`${longDay(d)}: ${(rhythm.days.get(d) ?? 0) > 0 ? 'listened' : 'no listening'}`}>
                <span className={`size-3 rounded-full ${s.streakDays.has(d) ? 'bg-brand' : (rhythm.days.get(d) ?? 0) > 0 ? LIT : 'bg-line'}`} />
                <span className={`font-mono text-[10px] ${d === today ? 'text-ink' : 'text-faint'}`}>{dateOf(d).toLocaleDateString([], { weekday: 'narrow' })}</span>
              </li>
            ))}
          </ol>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5">
            <Figure label="longest" value={`${s.longest} ${s.longest === 1 ? 'day' : 'days'}`} />
            <Figure label="days listened" value={String(s.activeDays)} />
            <Figure label="best day" value={s.best ? formatMinutes(s.best.minutes) : '—'} hint={s.best ? longDay(s.best.day) : undefined} />
            <Figure label="listened" value={formatMinutes(totalMinutes)} hint="all time" />
          </dl>
        </div>
      </section>

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
