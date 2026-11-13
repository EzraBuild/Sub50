const ADJECTIVES = ['Neon', 'Cobalt', 'Velvet', 'Static', 'Lunar', 'Amber', 'Quiet', 'Electric', 'Midnight', 'Golden', 'Hollow', 'Crystal'];
const NOUNS = ['Otter', 'Falcon', 'Moth', 'Lynx', 'Heron', 'Fox', 'Raven', 'Koi', 'Wolf', 'Panda', 'Gecko', 'Orca'];
const NAME_KEY = 'sub50:name';
const SESSION_KEY = 'sub50:session';

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/**
 * Stable for the life of this tab (survives reloads and reconnects, not new tabs),
 * so the server treats a reconnect as the same listener rather than a new one.
 */
export function getSessionId(): string {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    /* storage unavailable: fall through to a per-page-load id */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable (private mode) */
  }
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The link to hand to other devices. If this tab is on localhost, swap in the
 * machine's LAN address so a phone on the same Wi-Fi can actually reach it.
 */
export function shareUrl(roomId: string, lanAddresses: string[]): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  if (LOOPBACK.has(url.hostname) && lanAddresses[0]) url.hostname = lanAddresses[0];
  return url.toString();
}

/** Clipboard API needs a secure context; plain-http LAN pages fall back to execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
