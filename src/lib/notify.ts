import type { ChatMessage } from '../shared/protocol';

const PREF_KEY = 'sub50:notifyChat';
/** A message older than this when it reaches us (history, catch-up after a reconnect) never alerts. */
export const FRESH_MS = 30_000;
const BODY_MAX = 140;

/**
 * Messages in `messages` we haven't seen, from someone else, that just happened.
 * `now` is server time (message timestamps are server time too).
 */
export function newIncoming(messages: ChatMessage[], seen: ReadonlySet<string>, selfId: string, now: number): ChatMessage[] {
  return messages.filter((m) => !seen.has(m.id) && m.peerId !== selfId && now - m.at < FRESH_MS);
}

/** Title and body for the system notification about the latest message. */
export function notificationText(last: ChatMessage, roomId: string, unread: number): { title: string; body: string } {
  const text = last.text.length > BODY_MAX ? `${last.text.slice(0, BODY_MAX - 1)}…` : last.text;
  return { title: `${last.name} · ${roomId}`, body: unread > 1 ? `${text}\n+${unread - 1} more` : text };
}

/** "(3) ▶ Song — Sub50" */
export const withUnread = (title: string, unread: number) => (unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${title}` : title);

export const notificationsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

export function loadNotifyPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNotifyPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

let worker: Promise<ServiceWorkerRegistration | null> | null = null;

/** The tiny worker at /sw.js only handles notification clicks (no fetch handler, no caching). */
export function notificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  worker ??= navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
  return worker;
}

/**
 * Android Chrome only allows notifications through a service worker
 * (`new Notification()` throws there), so prefer the worker everywhere.
 */
export async function showNotification(title: string, options: NotificationOptions & { renotify?: boolean }): Promise<void> {
  const reg = await notificationWorker();
  if (reg) return reg.showNotification(title, options);
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* not allowed here */
  }
}
