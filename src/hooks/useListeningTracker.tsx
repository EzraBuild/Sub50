'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import type { ChatMessage, Peer, RoomState } from '../shared/protocol';
import { authEnabled } from '../lib/auth-config';
import { getSessionId } from '../lib/identity';
import { upsertLocal } from '../lib/localHistory';
import { ListeningTracker } from '../lib/listening';

/** Visits in progress in this tab: moving device history skips them (their tracker re-sends them in full). */
export const activeVisits = new Set<string>();

const TICK_MS = 5_000;
const SEND_EVERY_MS = 60_000;

interface TrackerProps {
  roomId: string;
  state: RoomState | null;
  peers: Peer[];
  selfId: string;
  selfName: string;
  messages: ChatMessage[];
  /** Server time: chat from before you entered isn't part of your visit. */
  serverNow: () => number;
  /** The current song's length (s) per the player, 0 while unknown. */
  duration: number;
}

/**
 * Records this visit while you're in the room (every minute, and when the tab is
 * hidden or closed). Signed in, it goes to your account; otherwise, or on a
 * server without accounts, it's kept on this device. Mount once you've entered.
 */
export function HistoryTracker(props: TrackerProps) {
  return authEnabled ? <WithAccount {...props} /> : <Tracker {...props} signedIn={false} />;
}

function WithAccount(props: TrackerProps) {
  const { isSignedIn } = useAuth();
  return <Tracker {...props} signedIn={!!isSignedIn} />;
}

function Tracker({ roomId, state, peers, selfId, selfName, messages, serverNow, duration, signedIn }: TrackerProps & { signedIn: boolean }) {
  const live = useRef({ state, peers, selfId, selfName, signedIn, messages, serverNow, duration });
  live.current = { state, peers, selfId, selfName, signedIn, messages, serverNow, duration };

  useEffect(() => {
    // One id per visit: the tab's session id plus when you entered.
    const tracker = new ListeningTracker(`${getSessionId().slice(0, 40)}-${Date.now().toString(36)}`, roomId, () => live.current.selfName, Date.now());
    const enteredAt = live.current.serverNow();
    activeVisits.add(tracker.id);
    let wasSignedIn = live.current.signedIn;

    const tick = () => {
      const { state: s, peers: p, selfId: me } = live.current;
      tracker.addChat(live.current.messages, me, enteredAt);
      tracker.tick(Date.now(), {
        playing: !!s?.isPlaying,
        videoId: s?.videoId ?? null,
        title: s?.title ?? null,
        others: p.filter((peer) => peer.id !== me).map((peer) => peer.name),
        duration: live.current.duration,
      });
    };

    const send = async (final: boolean) => {
      tick();
      // Signed in mid-visit: what went to the device goes to the account now, all of it.
      if (live.current.signedIn && !wasSignedIn) tracker.resetSent();
      wasSignedIn = live.current.signedIn;
      const session = tracker.pending();
      if (!session) return;
      if (!live.current.signedIn) {
        const { chat, ...visit } = session;
        upsertLocal(visit, chat);
        tracker.markSent(session);
        return;
      }
      const body = JSON.stringify(session);
      // A closing page can't await fetch; a beacon still carries the session cookie.
      if (final && navigator.sendBeacon?.('/api/history', new Blob([body], { type: 'application/json' }))) {
        tracker.markSent(session);
        return;
      }
      try {
        const r = await fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
        if (r.ok) tracker.markSent(session);
      } catch {
        /* offline: the next send carries the same, longer session */
      }
    };

    const flush = () => send(false);
    const ticker = setInterval(tick, TICK_MS);
    const sender = setInterval(flush, SEND_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && void send(true);
    const onPageHide = () => void send(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      activeVisits.delete(tracker.id);
      clearInterval(ticker);
      clearInterval(sender);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void send(true);
    };
  }, [roomId]);

  return null;
}
