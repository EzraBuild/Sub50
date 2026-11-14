import type { Peer } from '../shared/protocol';
import { SectionHead } from './Frame';
import { CrownIcon } from './icons';
import { Avatar } from './Avatar';
import { STATUS_META } from './TelemetryPill';

interface Props {
  peers: Peer[];
  selfId: string | null;
  hostId: string | null;
}

/** Everyone's self-reported lock state, so you can see the whole room converge. */
export function Peers({ peers, selfId, hostId }: Props) {
  return (
    <section id="listeners" className="scroll-mt-20 border-t border-line" aria-label="Listeners">
      <SectionHead index="05" title="Listeners" meta="drift · rtt" />
      <ul className="divide-y divide-line">
        {peers.map((p) => {
          const meta = STATUS_META[p.status];
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Avatar id={p.id} name={p.name} size={30} status={p.status} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                  {p.name}
                  {p.id === selfId && <span className="chip">you</span>}
                  {p.id === hostId && <CrownIcon size={12} className="text-warn" aria-label="host" />}
                </span>
                <span className={`mt-0.5 block font-mono text-[10px] tracking-[0.06em] ${meta.text}`}>{meta.label}</span>
              </span>
              <span className="text-right font-mono tabular-nums">
                <span className="block text-[13px] text-ink">{p.driftMs === null ? '—' : `${Math.abs(p.driftMs)}ms`}</span>
                <span className="block text-[10.5px] text-faint">{p.rttMs === null ? '—' : `${p.rttMs}ms rtt`}</span>
              </span>
            </li>
          );
        })}
        {peers.length === 0 && <li className="px-4 py-6 text-center font-mono text-[11px] text-muted">connecting…</li>}
      </ul>
    </section>
  );
}
