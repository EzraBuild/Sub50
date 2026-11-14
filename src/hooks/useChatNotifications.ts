import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../shared/protocol';
import { loadNotifyPref, newIncoming, notificationText, notificationWorker, notificationsSupported, saveNotifyPref, showNotification } from '../lib/notify';

interface Options {
  messages: ChatMessage[];
  selfId: string;
  roomId: string;
  /** Server time, to tell fresh messages from history. */
  serverNow: () => number;
  /** Called when the browser has notifications blocked for this site. */
  onBlocked: (message: string) => void;
}

/** Looking at this tab right now? (Still true while the YouTube frame inside it has focus.) */
const focused = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * Counts chat messages that arrive while you're elsewhere (for the tab title) and,
 * if you've turned it on, shows a system notification for them.
 */
export function useChatNotifications({ messages, selfId, roomId, serverNow, onBlocked }: Options) {
  const supported = notificationsSupported();
  const [enabled, setEnabled] = useState(() => supported && Notification.permission === 'granted' && loadNotifyPref());
  const [blocked, setBlocked] = useState(() => supported && Notification.permission === 'denied');
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const unreadRef = useRef(0);
  const live = useRef({ enabled, selfId, roomId, serverNow });
  live.current = { enabled, selfId, roomId, serverNow };

  useEffect(() => {
    // The first batch (chat history on join) is never "new".
    const incoming = seen.current ? newIncoming(messages, seen.current, live.current.selfId, live.current.serverNow()) : [];
    seen.current = new Set(messages.map((m) => m.id));
    if (incoming.length === 0 || focused()) return;
    unreadRef.current += incoming.length;
    setUnread(unreadRef.current);
    if (!live.current.enabled) return;
    const { title, body } = notificationText(incoming.at(-1)!, live.current.roomId, unreadRef.current);
    // One notification per room: each new one replaces the last (and still alerts).
    showNotification(title, { body, tag: `sub50-chat:${live.current.roomId}`, renotify: true, data: { url: location.href } }).catch(() => {
      /* permission revoked in site settings since */
    });
  }, [messages]);

  // Coming back to the tab clears the count.
  useEffect(() => {
    const back = () => {
      if (!focused() || unreadRef.current === 0) return;
      unreadRef.current = 0;
      setUnread(0);
    };
    const events = ['focus', 'pointerdown', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, back);
    document.addEventListener('visibilitychange', back);
    return () => {
      for (const e of events) window.removeEventListener(e, back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);

  useEffect(() => {
    if (enabled) void notificationWorker();
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (enabled) {
      setEnabled(false);
      saveNotifyPref(false);
      return;
    }
    // Resolves at once (no prompt) when already granted or denied; only 'default' shows the prompt.
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setBlocked(permission === 'denied');
    if (permission !== 'granted') {
      onBlocked('Notifications are blocked for this site. Allow them in your browser’s site settings.');
      return;
    }
    setEnabled(true);
    saveNotifyPref(true);
  }, [supported, enabled, onBlocked]);

  return { supported, enabled, blocked, unread, toggle };
}
