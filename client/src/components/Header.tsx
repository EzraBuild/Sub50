import type { SyncStatus } from '../../../shared/protocol';
import { LogoMark, UsersIcon } from './icons';
import { ShareButton } from './ShareButton';
import { TelemetryPill } from './TelemetryPill';

interface Props {
  roomId: string;
  status: SyncStatus;
  driftMs: number | null;
  rttMs: number | null;
  peerCount: number;
  shareUrl: string;
}

export function Header({ roomId, status, driftMs, rttMs, peerCount, shareUrl }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2" aria-label="Sub50 home (new room)">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight text-zinc-50">
            Sub<span className="text-emerald-400">50</span>
          </span>
        </a>
        <span className="hidden rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-zinc-500 sm:inline">
          {roomId}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <TelemetryPill status={status} driftMs={driftMs} rttMs={rttMs} />
          <a
            href="#peers"
            className="flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 font-mono text-[11px] text-zinc-300 hover:border-zinc-700"
            title={`${peerCount} connected`}
          >
            <UsersIcon size={14} />
            <span className="tabular-nums">{peerCount}</span>
          </a>
          <ShareButton url={shareUrl} />
        </div>
      </div>
    </header>
  );
}
