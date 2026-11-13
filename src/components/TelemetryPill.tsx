import type { SyncStatus } from '../shared/protocol';

export const STATUS_META: Record<SyncStatus, { label: string; dot: string; text: string; glow?: boolean; pulse?: boolean }> = {
  locked: { label: 'SUB50 LOCKED', dot: 'bg-lock', text: 'text-lock', glow: true },
  tolerant: { label: 'IN TOLERANCE', dot: 'bg-near', text: 'text-near' },
  correcting: { label: 'CORRECTING', dot: 'bg-warn', text: 'text-warn', pulse: true },
  seeking: { label: 'RESYNCING', dot: 'bg-hot', text: 'text-hot', pulse: true },
  holding: { label: 'ARMED', dot: 'bg-info', text: 'text-info', pulse: true },
  loading: { label: 'BUFFERING', dot: 'bg-muted', text: 'text-ink-2', pulse: true },
  paused: { label: 'PAUSED', dot: 'bg-muted', text: 'text-muted' },
  idle: { label: 'IDLE', dot: 'bg-faint', text: 'text-muted' },
  blocked: { label: 'TAP TO RESUME', dot: 'bg-warn', text: 'text-warn', pulse: true },
  offline: { label: 'OFFLINE', dot: 'bg-bad', text: 'text-bad', pulse: true },
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
      className="flex h-8 items-center gap-2 rounded-full border border-line bg-sunken/80 pr-3 pl-2.5 font-mono text-[11px] tracking-wide whitespace-nowrap"
      role="status"
      aria-live="polite"
      title="Drift = how far this device is from the room timeline. RTT = round trip to the sync server."
    >
      <StatusDot status={status} />
      {showDrift && <span className="text-ink tabular-nums">{Math.abs(driftMs)}ms</span>}
      {showDrift && <span className="text-faint">·</span>}
      <span className={m.text}>{m.label}</span>
      {rttMs !== null && (
        <span className="hidden items-center gap-2 text-muted sm:flex">
          <span className="h-3 w-px bg-line-strong" />
          <span className="tabular-nums">rtt {rttMs}ms</span>
        </span>
      )}
    </div>
  );
}
