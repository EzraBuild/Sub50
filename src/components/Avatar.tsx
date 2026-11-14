import type { SyncStatus } from '../shared/protocol';
import { STATUS_META } from './TelemetryPill';

/** FNV-1a: a stable 32-bit hash, so the same id gets the same colors on every device. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

interface Props {
  id: string;
  name: string;
  size?: number;
  /** Optional status dot in the corner. */
  status?: SyncStatus;
  className?: string;
}

/** A two-tone gradient with initials, derived from the listener's id. */
export function Avatar({ id, name, size = 28, status, className = '' }: Props) {
  const h = hash(id);
  const a = h % 360;
  const b = (a + 35 + ((h >>> 9) % 90)) % 360;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(135deg, oklch(0.74 0.14 ${a}), oklch(0.52 0.16 ${b}))`,
        textShadow: '0 1px 1px rgb(0 0 0 / 0.25)',
      }}
      aria-hidden
    >
      {initials(name)}
      {status && (
        <span className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-panel ${STATUS_META[status].dot} ${STATUS_META[status].pulse ? 'animate-pulse' : ''}`} />
      )}
    </span>
  );
}
