'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';
import type { ChatMessage, Peer, RoomState } from '../shared/protocol';
import { getSessionId } from '../lib/identity';
import { ListeningTracker } from '../lib/listening';

const flushers = new Set<() => Promise<void>>();

/** Sends the visit in progress now (used before showing history, so it's included). */
export const flushListening = () => Promise.all([...flushers].map((f) => f())).then(() => {});

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
}

/**
 * Records this visit while you're in the room and reports it to your account
 * (every minute, and when the tab is hidden or closed). Signing in mid-visit
 * keeps the whole visit. Mount only when accounts are enabled and you've entered.
 */
export function HistoryTracker({ roomId, state, peers, selfId, selfName, messages, serverNow }: TrackerProps) {
  const { isSignedIn } = useAuth();
  const live = useRef({ state, peers, selfId, selfName, isSignedIn, messages, serverNow });
  live.current = { state, peers, selfId, selfName, isSignedIn, messages, serverNow };

  useEffect(() => {
    // One id per visit: the tab's session id plus when you entered.
    const tracker = new ListeningTracker(`${getSessionId().slice(0, 40)}-${Date.now().toString(36)}`, roomId, () => live.current.selfName, Date.now());
    const enteredAt = live.current.serverNow();

    const tick = () => {
      const { state: s, peers: p, selfId: me } = live.current;
      tracker.addChat(live.current.messages, me, enteredAt);
      tracker.tick(Date.now(), {
        playing: !!s?.isPlaying,
        videoId: s?.videoId ?? null,
        title: s?.title ?? null,
        others: p.filter((peer) => peer.id !== me).map((peer) => peer.name),
      });
    };

    const send = async (final: boolean) => {
      tick();
      const session = tracker.pending();
      if (!session || !live.current.isSignedIn) return;
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
    flushers.add(flush);
    const ticker = setInterval(tick, TICK_MS);
    const sender = setInterval(flush, SEND_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && void send(true);
    const onPageHide = () => void send(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      flushers.delete(flush);
      clearInterval(ticker);
      clearInterval(sender);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void send(true);
    };
  }, [roomId]);

  return null;
}
