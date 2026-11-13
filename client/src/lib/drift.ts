import { SYNC, type RoomState } from '../../../shared/protocol';

/**
 * Where the room's playhead is at `serverNow`:
 *   expectedTime = lastTimestamp + (serverNow - updatedAt) / 1000
 * clamped so a start scheduled in the future reads as "parked at lastTimestamp".
 */
export function expectedTime(state: Pick<RoomState, 'isPlaying' | 'lastTimestamp' | 'updatedAt'>, serverNow: number): number {
  if (!state.isPlaying) return state.lastTimestamp;
  return state.lastTimestamp + Math.max(0, serverNow - state.updatedAt) / 1000;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type Correction =
  | { kind: 'none' }
  | { kind: 'nudge'; rate: number }
  | { kind: 'seek' };

/**
 * Picks a correction for a (smoothed) drift in seconds; positive = we're ahead.
 *
 * Steady state follows the spec bands exactly:
 *   < 50 ms          locked, do nothing
 *   50 – 150 ms      tolerated, do nothing (no audible artefacts)
 *   150 ms – 1.5 s   nudge playback rate ±5% until back under the target
 *   > 1.5 s          hard seek
 *
 * Right after a discontinuity (track load, seek, resume) we are `aligning`:
 * there is no audio continuity to protect yet, so we tighten the bands, using
 * a rate nudge from 50 ms and a seek beyond 250 ms instead of 1.5 s.
 */
export function chooseCorrection(drift: number, opts: { aligning: boolean; rateSupported: boolean }): Correction {
  const abs = Math.abs(drift);
  const seekAbove = opts.aligning ? 0.25 : SYNC.HARD_SEEK_S;
  const nudgeAbove = opts.aligning ? SYNC.LOCK_S : SYNC.TOLERANCE_S;
  if (abs > seekAbove) return { kind: 'seek' };
  if (abs > nudgeAbove) {
    if (!opts.rateSupported) return abs > SYNC.TOLERANCE_S ? { kind: 'seek' } : { kind: 'none' };
    return { kind: 'nudge', rate: drift > 0 ? SYNC.NUDGE_SLOW : SYNC.NUDGE_FAST };
  }
  return { kind: 'none' };
}

/** Should an in-flight rate nudge stop? (back on target, or overshot the zero line) */
export function nudgeDone(drift: number, rate: number): boolean {
  if (Math.abs(drift) < SYNC.NUDGE_TARGET_S) return true;
  return (rate > 1 && drift > 0) || (rate < 1 && drift < 0);
}
