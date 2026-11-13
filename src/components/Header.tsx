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

/** A strip of bordered cells, continuing the page frame's side rules. */
export function Header({ roomId, status, driftMs, rttMs, peerCount, shareUrl }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1200px] items-stretch border-line min-[1201px]:border-x">
        <a href="/" className="flex items-center gap-2.5 px-4 sm:px-5" aria-label="Sub50 home (new room)">
          <LogoMark size={20} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Sub<span className="text-lock">50</span>
          </span>
        </a>
        <div className="cell hidden md:flex">
          <span className="label">room</span>
          <span className="font-mono text-[12px] text-ink-2">{roomId}</span>
        </div>

        <div className="ml-auto flex items-stretch">
          <div className="cell">
            <TelemetryPill status={status} driftMs={driftMs} rttMs={rttMs} />
          </div>
          <a
            href="#listeners"
            className="cell hidden font-mono text-[12px] text-ink-2 transition-colors hover:bg-sunken sm:flex"
            title={`${peerCount} listening`}
          >
            <UsersIcon size={15} />
            <span className="tabular-nums">{peerCount}</span>
          </a>
          <div className="cell px-1.5 sm:px-2">
            <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink" />
          </div>
          <div className="cell px-1.5 sm:px-2">
            <ShareButton url={shareUrl} />
          </div>
        </div>
      </div>
    </header>
  );
}
