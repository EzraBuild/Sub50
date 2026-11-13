import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYNC, type RoomState, type SyncStatus } from '../shared/protocol';
import { chooseCorrection, clamp, expectedTime, median, nudgeDone, rateIsEffective } from '../lib/drift';
import type { SyncClient } from '../lib/sync-client';
import { YTState, describePlayerError, loadYouTubeApi } from '../lib/youtube-api';

/** Sampling cadence. Corrections are decided every DECIDE_EVERY ticks (1000 ms). */
const TICK_MS = 250;
const DECIDE_EVERY = 4;
/** Ignore drift for this long after (re)starting playback; the decoder needs to settle. */
const SETTLE_MS = 600;
/** How long programmatic commands keep the "this was us" guard raised. */
const GUARD_MS = 600;
/** Re-issue playVideo() if the player still hasn't started after this long... */
const PLAY_RETRY_MS = 1500;
/** ...and assume the browser is blocking autoplay after this long. */
const BLOCKED_AFTER_MS = 3000;
/** Give up on a rate nudge that hasn't converged and seek instead. */
const MAX_NUDGE_MS = 12_000;
/** Phones resume slower after a seek; start them with a bigger lead (it is learned either way). */
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const REPORT_EVERY_MS = 2000;

export interface SyncTelemetry {
  status: SyncStatus;
  /** Signed, smoothed drift in ms (positive = ahead of the room). */
  driftMs: number | null;
  rate: number;
}

interface Engine {
  loadedTrackId: string | null;
  pauseSeq: number;
  holdSeq: number;
  startTimer: ReturnType<typeof setTimeout> | null;
  startTimerFor: number;
  prerollMuted: boolean;
  rate: number;
  rateSupported: boolean | null;
  rateCheckAt: number;
  nudgeStartedAt: number;
  /** Drift when the current nudge began; used to check the nudge is doing anything. */
  nudgeStartDrift: number;
  nudgeVerified: boolean;
  settleUntil: number;
  playingSince: number | null;
  aligning: boolean;
  samples: number[];
  ticks: number;
  /** Learned: how far ahead to aim a seek so we land on the room after buffering (s). */
  seekLead: number;
  /** Learned: how early to call playVideo() so audio starts on the scheduled instant (ms). */
  startLeadMs: number;
  calibrate: 'seek' | 'start' | null;
  playIssuedAt: number | null;
  playFirstIssuedAt: number | null;
  userIntentUntil: number;
  lastReportAt: number;
}

const freshEngine = (): Engine => ({
  loadedTrackId: null,
  pauseSeq: -1,
  holdSeq: -1,
  startTimer: null,
  startTimerFor: 0,
  prerollMuted: false,
  rate: 1,
  rateSupported: null,
  rateCheckAt: 0,
  nudgeStartedAt: 0,
  nudgeStartDrift: 0,
  nudgeVerified: false,
  settleUntil: 0,
  playingSince: null,
  aligning: true,
  samples: [],
  ticks: 0,
  seekLead: isTouch() ? 0.25 : 0.08,
  startLeadMs: 40,
  calibrate: null,
  playIssuedAt: null,
  playFirstIssuedAt: null,
  userIntentUntil: 0,
  lastReportAt: 0,
});

/**
 * Owns the YouTube IFrame player and keeps it locked to the room timeline.
 *
 * The player is driven by a single idempotent `reconcile()` that compares the
 * desired state (room) with the actual state (player) and issues only the
 * commands needed to converge. It runs on every SYNC_STATE, every player state
 * change, and every 250 ms tick, so missed or reordered events self-heal.
 */
export function useYouTubeSync(client: SyncClient, room: RoomState | null) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const roomRef = useRef<RoomState | null>(room);
  /** True while the player is executing commands we issued in response to the room. */
  const isRemoteUpdateRef = useRef(false);
  const guardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockedRef = useRef(false);
  const engRef = useRef<Engine>(freshEngine());

  const [ready, setReady] = useState(false);
  const [playerState, setPlayerState] = useState<number>(YTState.UNSTARTED);
  const [duration, setDuration] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SyncTelemetry>({ status: 'idle', driftMs: null, rate: 1 });

  const api = useMemo(() => {
    const eng = engRef.current;

    // --- helpers ---------------------------------------------------------

    /** Run player commands with the remote-update guard raised so onStateChange won't echo them. */
    const remote = (fn: (p: YT.Player) => void) => {
      const p = playerRef.current;
      if (!p) return;
      isRemoteUpdateRef.current = true;
      if (guardTimerRef.current) clearTimeout(guardTimerRef.current);
      try {
        fn(p);
      } finally {
        guardTimerRef.current = setTimeout(() => (isRemoteUpdateRef.current = false), GUARD_MS);
      }
    };

    const publish = (status: SyncStatus, driftS: number | null) => {
      const driftMs = driftS === null ? null : Math.round(driftS * 1000);
      setTelemetry((t) => (t.status === status && t.driftMs === driftMs && t.rate === eng.rate ? t : { status, driftMs, rate: eng.rate }));
      const now = performance.now();
      const s = roomRef.current;
      if (s && now - eng.lastReportAt > REPORT_EVERY_MS) {
        eng.lastReportAt = now;
        client.send({ type: 'REPORT', roomId: s.roomId, driftMs, rttMs: client.clock.rtt, status });
      }
    };

    const setRate = (rate: number) => {
      if (eng.rate === rate) return;
      eng.rate = rate;
      remote((p) => p.setPlaybackRate(rate));
      if (rate !== 1) {
        eng.nudgeStartedAt = performance.now();
        eng.rateCheckAt = performance.now() + 800;
      }
    };

    const unmutePreroll = () => {
      if (!eng.prerollMuted) return;
      eng.prerollMuted = false;
      remote((p) => p.unMute());
    };

    const clearStartTimer = () => {
      if (eng.startTimer) clearTimeout(eng.startTimer);
      eng.startTimer = null;
      eng.startTimerFor = 0;
    };

    /** Discontinuity: restart smoothing and require a fresh alignment pass. */
    const markDiscontinuity = (calibrate: Engine['calibrate']) => {
      eng.samples = [];
      eng.aligning = true;
      eng.settleUntil = performance.now() + SETTLE_MS;
      eng.calibrate = calibrate;
    };

    const hardSeek = (s: RoomState) => {
      setRate(1);
      const target = expectedTime(s, client.clock.serverNow()) + eng.seekLead;
      remote((p) => p.seekTo(target, true));
      markDiscontinuity('seek');
    };

    // --- the reconciler -------------------------------------------------

    const reconcile = (source: 'tick' | 'event' | 'state' | 'timer' | 'unlock') => {
      const p = playerRef.current;
      const s = roomRef.current;
      if (!p || !s) return;

      const now = performance.now();
      const serverNow = client.clock.serverNow();
      const yt = p.getPlayerState?.() ?? YTState.UNSTARTED;
      const cur = p.getCurrentTime?.() || 0;

      if (yt === YTState.PLAYING) eng.playingSince ??= now;
      else eng.playingSince = null;

      // 0. Nothing to play.
      if (!s.videoId || !s.trackId) {
        if (eng.loadedTrackId) {
          remote((pl) => pl.stopVideo());
          eng.loadedTrackId = null;
        }
        clearStartTimer();
        return publish('idle', null);
      }

      // 1. New track: cue (gate still up / room paused), muted preroll (start is
      //    scheduled ahead), or a straight load when we are joining late.
      if (s.trackId !== eng.loadedTrackId) {
        eng.loadedTrackId = s.trackId;
        clearStartTimer();
        setRate(1);
        setError(null);
        setDuration(0);
        eng.playIssuedAt = eng.playFirstIssuedAt = null;
        const videoId = s.videoId;
        const startsInMs = s.updatedAt - serverNow;
        if (!unlockedRef.current || !s.isPlaying) {
          remote((pl) => pl.cueVideoById({ videoId, startSeconds: expectedTime(s, serverNow) }));
        } else if (startsInMs > 200) {
          eng.prerollMuted = true;
          remote((pl) => {
            pl.mute();
            pl.loadVideoById({ videoId, startSeconds: s.lastTimestamp });
          });
        } else {
          remote((pl) => pl.loadVideoById({ videoId, startSeconds: expectedTime(s, serverNow) + eng.seekLead }));
          // loadVideoById autoplays; count it as the play attempt so step 4 doesn't
          // pile a second seek + play onto a load that is still in flight.
          eng.playIssuedAt = eng.playFirstIssuedAt = now;
        }
        markDiscontinuity(null);
        return publish('loading', null);
      }

      if (!unlockedRef.current) return publish(s.isPlaying ? 'loading' : 'paused', null);

      // A local pause/play (embed tap, OS media keys) is in flight to the server: don't fight it.
      if (now < eng.userIntentUntil) return;

      // 2. Room is paused: stop and park exactly on lastTimestamp.
      if (!s.isPlaying) {
        clearStartTimer();
        setRate(1);
        eng.playIssuedAt = eng.playFirstIssuedAt = null;
        setBlocked(false);
        const needsPause = yt === YTState.PLAYING || yt === YTState.BUFFERING;
        // (seekTo from ENDED would restart playback, so a finished track just stays put.)
        const needsPark = eng.pauseSeq !== s.seq && yt !== YTState.ENDED && Math.abs(cur - s.lastTimestamp) > 0.05;
        eng.pauseSeq = s.seq;
        if (needsPause || needsPark) {
          remote((pl) => {
            if (needsPause) pl.pauseVideo();
            if (!needsPark) return;
            if (yt === YTState.CUED || yt === YTState.UNSTARTED) pl.cueVideoById({ videoId: s.videoId!, startSeconds: s.lastTimestamp });
            else pl.seekTo(s.lastTimestamp, true);
          });
        }
        unmutePreroll();
        return publish('paused', null);
      }

      // 3. Start is scheduled in the future: hold on the start line, buffered, and
      //    arm a timer to call playVideo() just early enough to hit it.
      const startsInMs = s.updatedAt - serverNow;
      if (startsInMs > eng.startLeadMs) {
        if (eng.startTimerFor !== s.updatedAt) {
          clearStartTimer();
          eng.startTimerFor = s.updatedAt;
          eng.startTimer = setTimeout(() => {
            eng.startTimer = null;
            reconcile('timer');
          }, startsInMs - eng.startLeadMs);
        }
        if (yt === YTState.PLAYING) {
          remote((pl) => {
            pl.pauseVideo();
            pl.seekTo(s.lastTimestamp, true);
          });
          eng.holdSeq = s.seq;
        } else if (yt === YTState.PAUSED) {
          if (eng.holdSeq !== s.seq && Math.abs(cur - s.lastTimestamp) > 0.03) remote((pl) => pl.seekTo(s.lastTimestamp, true));
          eng.holdSeq = s.seq;
          unmutePreroll(); // parked and silent: safe to restore volume
        } else if ((yt === YTState.CUED || yt === YTState.UNSTARTED) && !eng.prerollMuted) {
          // Not buffered yet: play muted to fill the buffer, we'll pause on PLAYING.
          eng.prerollMuted = true;
          remote((pl) => {
            pl.mute();
            pl.playVideo();
          });
        }
        return publish('holding', null);
      }

      // 4. Room is live: make sure the player is actually playing.
      if (yt !== YTState.PLAYING) {
        if (yt === YTState.BUFFERING || yt === YTState.ENDED) return publish('loading', null);
        if (document.visibilityState === 'hidden') return publish('loading', null);
        const expected = expectedTime(s, serverNow);
        const needsSeek = Math.abs(cur - expected) > SYNC.TOLERANCE_S || yt !== YTState.PAUSED;
        if (eng.playIssuedAt === null || now - eng.playIssuedAt > PLAY_RETRY_MS) {
          unmutePreroll();
          remote((pl) => {
            if (needsSeek) pl.seekTo(expected + eng.seekLead, true);
            pl.playVideo();
          });
          eng.playIssuedAt = now;
          eng.playFirstIssuedAt ??= now;
          markDiscontinuity(needsSeek ? 'seek' : 'start');
        }
        if (eng.playFirstIssuedAt !== null && now - eng.playFirstIssuedAt > BLOCKED_AFTER_MS) {
          setBlocked(true);
          return publish('blocked', null);
        }
        return publish(needsSeek ? 'seeking' : 'loading', null);
      }

      // 5. Playing. Measure drift and correct it.
      eng.playIssuedAt = eng.playFirstIssuedAt = null;
      setBlocked(false);
      unmutePreroll();
      clearStartTimer();

      const drift = cur - expectedTime(s, serverNow);
      const settling = now < eng.settleUntil || now - (eng.playingSince ?? now) < SETTLE_MS;
      if (settling) return publish(eng.calibrate === 'seek' ? 'seeking' : 'loading', null);
      if (source !== 'tick') return; // sample on a steady cadence only

      eng.samples.push(drift);
      if (eng.samples.length > 3) eng.samples.shift();
      const d = median(eng.samples);
      const abs = Math.abs(d);

      // Learn from the first settled reading after a seek / scheduled start.
      if (eng.calibrate && eng.samples.length >= 2) {
        if (eng.calibrate === 'seek') eng.seekLead = clamp(eng.seekLead - d * 0.6, 0, 1.2);
        else eng.startLeadMs = clamp(eng.startLeadMs - d * 1000 * 0.5, 0, 250);
        eng.calibrate = null;
      }

      // Did setPlaybackRate(1.05) actually stick? Some videos only allow coarse rates.
      if (eng.rate !== 1 && eng.rateSupported === null && now > eng.rateCheckAt) {
        eng.rateSupported = Math.abs(p.getPlaybackRate() - eng.rate) < 0.001;
        if (!eng.rateSupported) eng.rate = 1;
      }

      if (eng.rate !== 1) {
        const elapsed = now - eng.nudgeStartedAt;
        if (nudgeDone(d, eng.rate)) {
          setRate(1);
          eng.aligning = false;
          eng.rateSupported = true;
        } else if (!eng.nudgeVerified && elapsed >= SYNC.NUDGE_VERIFY_MS) {
          // Judge the nudge by its effect, not by what the player reports.
          if (rateIsEffective(eng.nudgeStartDrift, d, eng.rate, elapsed / 1000)) {
            eng.nudgeVerified = true;
            eng.rateSupported = true;
          } else {
            eng.rateSupported = false; // this player ignores fractional rates: seek from now on
            hardSeek(s);
            return publish('seeking', d);
          }
        }
        if (eng.rate !== 1) {
          if (abs > SYNC.HARD_SEEK_S || elapsed > MAX_NUDGE_MS) {
            hardSeek(s);
            return publish('seeking', d);
          }
          return publish('correcting', d);
        }
      }

      eng.ticks++;
      if (eng.samples.length >= 2 && (eng.aligning || eng.ticks % DECIDE_EVERY === 0)) {
        const fix = chooseCorrection(d, { aligning: eng.aligning, rateSupported: eng.rateSupported !== false });
        if (fix.kind === 'seek') {
          hardSeek(s);
          return publish('seeking', d);
        }
        if (fix.kind === 'nudge') {
          setRate(fix.rate);
          eng.nudgeStartDrift = d;
          eng.nudgeVerified = false;
          return publish('correcting', d);
        }
        eng.aligning = false;
      }

      publish(abs < SYNC.LOCK_S ? 'locked' : abs <= SYNC.TOLERANCE_S ? 'tolerant' : 'correcting', d);
    };

    // --- player events ---------------------------------------------------

    const onStateChange = (e: YT.OnStateChangeEvent) => {
      const p = e.target;
      const st = e.data as number;
      setPlayerState(st);
      if (st === YTState.PLAYING || st === YTState.CUED) {
        const d = p.getDuration?.();
        if (d) setDuration(d);
      }

      const s = roomRef.current;
      const live = !!s?.trackId && s.trackId === eng.loadedTrackId;

      if (st === YTState.ENDED) {
        if (live && s!.isPlaying) client.send({ type: 'TRACK_ENDED', roomId: s!.roomId, trackId: s!.trackId! });
        return;
      }

      // Not ours: the user poked the embed, the OS media controls, or headphones.
      if (!isRemoteUpdateRef.current && unlockedRef.current && live && !eng.prerollMuted) {
        const room = s!;
        // Only a pause out of steady playback is a person. A browser blocking autoplay
        // can also report PAUSED, and that must never pause the whole room.
        const steady = eng.playingSince !== null && performance.now() - eng.playingSince > 1000;
        if (st === YTState.PAUSED && steady && room.isPlaying && client.clock.serverNow() >= room.updatedAt) {
          const at = p.getCurrentTime();
          eng.userIntentUntil = performance.now() + 700;
          // Phones pause media when the screen locks. Only share pauses made while visible.
          setTimeout(() => {
            if (document.visibilityState !== 'visible' || isRemoteUpdateRef.current) return;
            if (p.getPlayerState() !== YTState.PAUSED) return;
            eng.userIntentUntil = performance.now() + 1500;
            client.send({ type: 'PAUSE', roomId: room.roomId, timestamp: at });
          }, 250);
          return;
        }
        if (st === YTState.PLAYING && !room.isPlaying) {
          eng.userIntentUntil = performance.now() + 1500;
          client.send({ type: 'PLAY', roomId: room.roomId, timestamp: p.getCurrentTime() });
          return;
        }
      }
      reconcile('event');
    };

    const onError = (e: YT.OnErrorEvent) => {
      setError(describePlayerError(e.data as number));
      publish('idle', null);
    };

    return { reconcile, onStateChange, onError, remote, hardSeek, markDiscontinuity, clearStartTimer };
  }, [client]);

  // --- lifecycle -----------------------------------------------------------

  // Create the player once. YT replaces the mount node with its iframe, so we
  // give it a node React doesn't own.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let player: YT.Player | null = null;
    const mount = document.createElement('div');
    host.appendChild(mount);

    loadYouTubeApi()
      .then((YTApi) => {
        if (cancelled) return;
        player = new YTApi.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            playsinline: 1, // iOS: never hijack to fullscreen
            rel: 0,
            iv_load_policy: 3,
            fs: 0,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              playerRef.current = player;
              setReady(true);
              api.reconcile('state');
            },
            onStateChange: (e) => api.onStateChange(e),
            onError: (e) => api.onError(e),
          },
        });
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      cancelled = true;
      api.clearStartTimer();
      playerRef.current = null;
      engRef.current = Object.assign(engRef.current, freshEngine());
      setReady(false);
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      host.replaceChildren();
    };
  }, [api]);

  // Every room update (play/pause/seek/track/queue) runs the reconciler.
  useEffect(() => {
    roomRef.current = room;
    api.reconcile('state');
  }, [room, api]);

  // The 250 ms sampler / 1 s corrector.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => api.reconcile('tick'), TICK_MS);
    return () => clearInterval(id);
  }, [ready, api]);

  // Phones freeze timers in the background; re-measure everything on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      client.resyncClock();
      const eng = engRef.current;
      eng.playIssuedAt = eng.playFirstIssuedAt = null;
      api.markDiscontinuity(null);
      api.reconcile('state');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [client, api]);

  // --- public controls -----------------------------------------------------

  /**
   * Must run synchronously inside a tap/click handler. Plays (muted) and pauses
   * once so mobile browsers mark the media element as user-activated, then
   * immediately syncs to the room so that the first real play is still part of
   * the same gesture.
   */
  const unlock = useCallback(() => {
    unlockedRef.current = true;
    setBlocked(false);
    const eng = engRef.current;
    eng.playIssuedAt = eng.playFirstIssuedAt = null;
    eng.userIntentUntil = 0;
    if (!playerRef.current) return; // not ready yet: onReady will reconcile
    api.remote((p) => {
      p.mute();
      p.playVideo();
      p.pauseVideo();
      p.unMute();
    });
    eng.prerollMuted = false;
    api.reconcile('unlock');
  }, [api]);

  /** Manual "Resync": fresh clock estimate plus a hard seek onto the room timeline. */
  const resync = useCallback(() => {
    client.resyncClock();
    const s = roomRef.current;
    if (!s?.videoId || !playerRef.current) return;
    if (s.isPlaying) api.hardSeek(s);
    else api.remote((p) => p.seekTo(s.lastTimestamp, true));
  }, [client, api]);

  /** Current playhead for the UI (read every animation frame). */
  const getPosition = useCallback((): number => {
    const s = roomRef.current;
    if (!s) return 0;
    const p = playerRef.current;
    if (p && unlockedRef.current && p.getPlayerState?.() === YTState.PLAYING) return p.getCurrentTime();
    return expectedTime(s, client.clock.serverNow());
  }, [client]);

  const getLoadedFraction = useCallback((): number => playerRef.current?.getVideoLoadedFraction?.() ?? 0, []);

  // Duration can arrive late for some videos; poll cheaply until we have it.
  useEffect(() => {
    if (!ready || duration > 0 || !room?.videoId) return;
    const id = setInterval(() => {
      const d = playerRef.current?.getDuration?.();
      if (d) setDuration(d);
    }, 500);
    return () => clearInterval(id);
  }, [ready, duration, room?.videoId]);

  return {
    hostRef,
    ready,
    playerState,
    duration,
    blocked,
    error,
    telemetry,
    unlock,
    resync,
    getPosition,
    getLoadedFraction,
  };
}
