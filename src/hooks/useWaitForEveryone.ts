import { useEffect, useRef } from 'react';
import { SYNC, type RoomState } from '../shared/protocol';

/** Buffered this far ahead (s), a waited-for listener says it's ready. */
export const READY_AHEAD_S = 4;
const TICK_MS = 250;
const CHECK_EVERY_MS = 2000;

export interface StallProbe {
  /** How long the player has been stuck while the room plays (ms), 0 when it isn't. */
  stalledMs: () => number;
  /** Seconds buffered past the playhead. */
  bufferedAhead: () => number;
  /** 0..1 of the track loaded (1 = all of it). */
  loadedFraction: () => number;
}

interface Options {
  state: RoomState | null;
  selfId: string;
  probe: StallProbe;
  stall: (stalled: boolean) => void;
  check: () => void;
}

/** Decides when this listener asks the room to wait, and when it's ready again. Pure, for tests. */
export function nextStallAction(
  s: RoomState | null,
  selfId: string,
  asked: boolean,
  probe: Pick<StallProbe, 'stalledMs' | 'bufferedAhead' | 'loadedFraction'>,
): 'stall' | 'ready' | null {
  if (!s?.videoId) return asked ? 'ready' : null;
  const waitingForMe = !!s.waiting?.peers.some((p) => p.id === selfId);
  if (!asked && !waitingForMe) {
    return (s.waitForAll ?? true) && s.isPlaying && probe.stalledMs() >= SYNC.STALL_AFTER_MS ? 'stall' : null;
  }
  // We asked (or the room is waiting on us): say so once we can keep up.
  const ready = s.isPlaying ? probe.stalledMs() === 0 : probe.bufferedAhead() >= READY_AHEAD_S || probe.loadedFraction() >= 0.999;
  return ready ? 'ready' : null;
}

/**
 * "Wait for everyone", this device's part: tell the room when we've been stuck
 * buffering for a while and when we're ready again, and, while the room waits,
 * nudge it to check for timeouts and listeners who left.
 */
export function useWaitForEveryone({ state, selfId, probe, stall, check }: Options): void {
  const live = useRef({ state, selfId, probe, stall, check });
  live.current = { state, selfId, probe, stall, check };

  useEffect(() => {
    let asked = false;
    let lastCheck = 0;
    const timer = setInterval(() => {
      const { state: s, selfId: me, probe: p } = live.current;
      const action = nextStallAction(s, me, asked, p);
      if (action === 'stall') {
        live.current.stall(true);
        asked = true;
      } else if (action === 'ready') {
        live.current.stall(false);
        asked = false;
      }
      // Someone has to call time on a wait; every listener offers (the room ignores extras).
      const now = Date.now();
      if (s?.waiting && now - lastCheck >= CHECK_EVERY_MS) {
        lastCheck = now;
        live.current.check();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
