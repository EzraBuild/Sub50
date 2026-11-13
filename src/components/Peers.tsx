import type { Peer } from '../shared/protocol';
import { CrownIcon } from './icons';
import { STATUS_META, StatusDot } from './TelemetryPill';

interface Props {
  peers: Peer[];
  selfId: string | null;
  hostId: string | null;
}

/** Everyone's self-reported lock state, so you can see the whole room converge. */
export function Peers({ peers, selfId, hostId }: Props) {
  return (
    <section id="peers" className="card scroll-mt-20" aria-label="Listeners">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="label">Listeners</h3>
        <span className="font-mono text-[11px] text-faint">drift · rtt</span>
      </div>
      <ul className="divide-y divide-line">
        {peers.map((p) => {
          const meta = STATUS_META[p.status];
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <StatusDot status={p.status} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[13px] text-ink">
                  {p.name}
                  {p.id === selfId && <span className="text-[11px] text-muted">(you)</span>}
                  {p.id === hostId && <CrownIcon size={12} className="text-warn/80" aria-label="host" />}
                </span>
                <span className={`block font-mono text-[10px] tracking-wide ${meta.text}`}>{meta.label}</span>
              </span>
              <span className="text-right font-mono text-[11px] text-muted tabular-nums">
                {p.driftMs === null ? '—' : `${Math.abs(p.driftMs)}ms`}
                <span className="text-faint"> · {p.rttMs === null ? '—' : `${p.rttMs}ms`}</span>
              </span>
            </li>
          );
        })}
        {peers.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">Connecting…</li>}
      </ul>
    </section>
  );
}
