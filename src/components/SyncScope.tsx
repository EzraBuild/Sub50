import type { Peer, SyncStatus } from '../shared/protocol';
import { SectionHead } from './Frame';
import { SHOWS_DRIFT, STATUS_META } from './TelemetryPill';

/** Visible window, in ms either side of the room clock. */
const RANGE = 300;
const TICKS = [-300, -150, -50, 0, 50, 150, 300];

interface Props {
  peers: Peer[];
  selfId: string;
  /** This device's live drift (4Hz) — fresher than the throttled copy the server relays. */
  self: { driftMs: number | null; status: SyncStatus };
}

const pct = (ms: number) => ((Math.max(-RANGE, Math.min(RANGE, ms)) + RANGE) / (2 * RANGE)) * 100;

/**
 * Every listener on one ruler: where they sit against the room clock, and whether
 * they're inside the ±50ms lock zone. Ahead is right, behind is left.
 */
export function SyncScope({ peers, selfId, self }: Props) {
  const plotted = peers
    .map((p) => (p.id === selfId ? { ...p, driftMs: self.driftMs, status: self.status } : p))
    .filter((p): p is Peer & { driftMs: number } => p.driftMs !== null && SHOWS_DRIFT.has(p.status))
    .sort((a, b) => a.driftMs - b.driftMs);
  const idle = peers.length - plotted.length;
  const locked = plotted.filter((p) => Math.abs(p.driftMs) < 50).length;

  const summary = plotted.length
    ? plotted.map((p) => `${p.name} ${Math.abs(p.driftMs)}ms ${p.driftMs >= 0 ? 'ahead' : 'behind'}`).join(', ')
    : 'nobody playing';

  return (
    <section aria-label="Sync scope" className="border-t border-line">
      <SectionHead
        index="02"
        title="Sync scope"
        meta={
          plotted.length ? (
            <span>
              <span className={locked === plotted.length ? 'text-lock' : 'text-warn'}>
                {locked}/{plotted.length} locked
              </span>
              {idle > 0 && <span className="text-faint"> · {idle} idle</span>}
            </span>
          ) : (
            'waiting for playback'
          )
        }
      />

      <div className="px-4 pt-3 pb-4 sm:px-6" role="img" aria-label={`Room sync: ${summary}.`}>
        <div className="relative h-[124px] overflow-hidden rounded-lg border border-line bg-sunken/60">
          <div aria-hidden className="dot-grid absolute inset-0 opacity-40" />

          {/* tolerance (±150) and lock (±50) zones */}
          <div className="absolute inset-y-0 border-x border-dashed border-line-strong/80" style={{ left: `${pct(-150)}%`, right: `${100 - pct(150)}%` }} />
          <div className="absolute inset-y-0 border-x border-lock/40 bg-lock/10" style={{ left: `${pct(-50)}%`, right: `${100 - pct(50)}%` }} />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-lock/60" />
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2 font-mono text-[9.5px] tracking-[0.08em] text-lock uppercase">room</span>

          {/* slow scan line */}
          <div aria-hidden className="scope-scan absolute inset-y-0 w-px bg-ink/25" />

          {plotted.map((p, i) => {
            const meta = STATUS_META[p.status];
            const below = i % 2 === 1;
            const off = Math.abs(p.driftMs) > RANGE;
            const isSelf = p.id === selfId;
            const x = pct(p.driftMs);
            // Keep edge markers fully inside the track, and anchor their labels inward.
            const left = Math.min(98.5, Math.max(1.5, x));
            const shift = x < 18 ? '-2px' : x > 82 ? 'calc(-100% + 2px)' : '-50%';
            return (
              <div key={p.id} className="absolute inset-y-0 transition-[left] duration-700 ease-out" style={{ left: `${left}%` }}>
                <div className={`absolute top-1/2 left-0 h-7 w-px -translate-x-1/2 ${below ? '' : '-translate-y-full'} bg-line-strong`} />
                <span
                  className={`absolute top-1/2 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${meta.dot} ${
                    isSelf ? 'ring-2 ring-ink ring-offset-2 ring-offset-sunken' : ''
                  }`}
                />
                <span
                  className={`absolute left-0 font-mono text-[10px] whitespace-nowrap ${below ? 'top-[calc(50%+30px)]' : 'bottom-[calc(50%+30px)]'}`}
                  style={{ transform: `translateX(${shift})` }}
                >
                  <span className={isSelf ? 'font-semibold text-ink' : 'text-ink-2'}>{isSelf ? 'you' : p.name.split(' ')[0]}</span>{' '}
                  <span className={meta.text}>
                    {off ? (p.driftMs < 0 ? '◀ ' : '') : ''}
                    {p.driftMs > 0 ? '+' : ''}
                    {p.driftMs}ms
                    {off && p.driftMs > 0 ? ' ▶' : ''}
                  </span>
                </span>
              </div>
            );
          })}

          {plotted.length === 0 && (
            <p className="absolute inset-x-0 bottom-3 text-center font-mono text-[10.5px] text-faint">markers appear once the room is playing</p>
          )}
        </div>

        <div aria-hidden className="relative mt-1.5 h-3 font-mono text-[9.5px] text-faint tabular-nums">
          {TICKS.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
              {t > 0 ? `+${t}` : t}
            </span>
          ))}
        </div>
        <p aria-hidden className="mt-2 flex justify-between font-mono text-[9.5px] tracking-[0.08em] text-faint uppercase">
          <span>← behind</span>
          <span>ahead →</span>
        </p>
      </div>
    </section>
  );
}
