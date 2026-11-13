import type { SyncStatus } from '../../../shared/protocol';

export const STATUS_META: Record<SyncStatus, { label: string; dot: string; text: string; glow?: boolean; pulse?: boolean }> = {
  locked: { label: 'SUB50 LOCKED', dot: 'bg-emerald-400', text: 'text-emerald-300', glow: true },
  tolerant: { label: 'IN TOLERANCE', dot: 'bg-lime-300', text: 'text-lime-200' },
  correcting: { label: 'CORRECTING', dot: 'bg-amber-400', text: 'text-amber-200', pulse: true },
  seeking: { label: 'RESYNCING', dot: 'bg-orange-400', text: 'text-orange-200', pulse: true },
  holding: { label: 'ARMED', dot: 'bg-sky-400', text: 'text-sky-200', pulse: true },
  loading: { label: 'BUFFERING', dot: 'bg-zinc-400', text: 'text-zinc-300', pulse: true },
  paused: { label: 'PAUSED', dot: 'bg-zinc-500', text: 'text-zinc-400' },
  idle: { label: 'IDLE', dot: 'bg-zinc-600', text: 'text-zinc-500' },
  blocked: { label: 'TAP TO RESUME', dot: 'bg-amber-400', text: 'text-amber-200', pulse: true },
  offline: { label: 'OFFLINE', dot: 'bg-rose-500', text: 'text-rose-300', pulse: true },
};

const SHOWS_DRIFT: ReadonlySet<SyncStatus> = new Set(['locked', 'tolerant', 'correcting', 'seeking']);

export function StatusDot({ status, className = '' }: { status: SyncStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${m.dot} ${m.glow ? 'lock-glow' : ''} ${m.pulse ? 'animate-pulse' : ''} ${className}`}
    />
  );
}

export function TelemetryPill({ status, driftMs, rttMs }: { status: SyncStatus; driftMs: number | null; rttMs: number | null }) {
  const m = STATUS_META[status];
  const showDrift = driftMs !== null && SHOWS_DRIFT.has(status);
  return (
    <div
      className="flex h-8 items-center gap-2 rounded-full border border-line bg-zinc-900/80 pr-3 pl-2.5 font-mono text-[11px] tracking-wide whitespace-nowrap"
      role="status"
      aria-live="polite"
      title="Drift = how far this device is from the room timeline. RTT = round trip to the sync server."
    >
      <StatusDot status={status} />
      {showDrift && <span className="text-zinc-100 tabular-nums">{Math.abs(driftMs)}ms</span>}
      {showDrift && <span className="text-zinc-600">·</span>}
      <span className={m.text}>{m.label}</span>
      {rttMs !== null && (
        <span className="hidden items-center gap-2 text-zinc-500 sm:flex">
          <span className="h-3 w-px bg-zinc-700" />
          <span className="tabular-nums">rtt {rttMs}ms</span>
        </span>
      )}
    </div>
  );
}
