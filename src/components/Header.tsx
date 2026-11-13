import type { SyncStatus } from '../shared/protocol';
import { LogoMark, UsersIcon } from './icons';
import { ShareButton } from './ShareButton';
import { TelemetryPill } from './TelemetryPill';
import { ThemeToggle } from './ThemeToggle';

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
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2" aria-label="Sub50 home (new room)">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight text-ink">
            Sub<span className="text-lock">50</span>
          </span>
        </a>
        <span className="hidden rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-muted sm:inline">
          {roomId}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <TelemetryPill status={status} driftMs={driftMs} rttMs={rttMs} />
          <a
            href="#peers"
            className="flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 font-mono text-[11px] text-ink-2 hover:border-line-strong"
            title={`${peerCount} connected`}
          >
            <UsersIcon size={14} />
            <span className="tabular-nums">{peerCount}</span>
          </a>
          <ThemeToggle />
          <ShareButton url={shareUrl} />
        </div>
      </div>
    </header>
  );
}
