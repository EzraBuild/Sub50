import type { ListeningSession, SessionChatMessage, VisitStub } from '../server/accounts/history';
import { clearLocalStubs, loadLocal, removeLocal } from './localHistory';

type Storage = Parameters<typeof loadLocal>[0];
/** Sends one session (with its chat) to the account; resolves true when the server accepted it. */
export type Upload = (session: ListeningSession & { chat: SessionChatMessage[] }) => Promise<boolean>;
/** Sends the device's older-visit stubs; resolves true when accepted. */
export type UploadStubs = (stubs: VisitStub[]) => Promise<boolean>;

/**
 * Moves what this device remembers into the signed-in account: each session is
 * uploaded (an upsert by id, so retries are harmless) and removed locally once
 * accepted. Sessions in `skip` (a visit still in progress, which its tracker
 * re-sends in full) are left alone. Returns how many moved and how many are
 * still waiting for a retry.
 */
export async function moveLocalToAccount(
  upload: Upload,
  skip: ReadonlySet<string> = new Set(),
  s?: Storage,
  uploadStubs: UploadStubs = uploadStubsToAccount,
): Promise<{ moved: number; left: number }> {
  const { sessions, chats, stubs } = loadLocal(s);
  // Older visits first: one request, then they're the account's.
  if (stubs.length && (await uploadStubs(stubs).catch(() => false))) clearLocalStubs(s);
  let moved = 0;
  let left = 0;
  // Oldest first, so an interrupted move keeps the newest on the device.
  for (const session of [...sessions].reverse()) {
    if (skip.has(session.id)) continue;
    const ok = await upload({ ...session, chat: chats[session.id] ?? [] }).catch(() => false);
    if (ok) {
      removeLocal(session.id, s);
      moved++;
    } else {
      left++;
    }
  }
  return { moved, left };
}

/** The real stubs upload: POST /api/history { stubs }. */
export const uploadStubsToAccount: UploadStubs = async (stubs) => {
  const r = await fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stubs }) });
  return r.ok;
};

/** The real upload: POST /api/history (202 "too short to keep" counts as done). */
export const uploadToAccount: Upload = async (session) => {
  const r = await fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(session) });
  return r.ok;
};

let moving: Promise<{ moved: number; left: number }> | null = null;

/** Moves device history into the account once at a time (the room and /me may both ask). */
export function moveGuestHistory(skip: ReadonlySet<string> = new Set()): Promise<{ moved: number; left: number }> {
  const local = loadLocal();
  if (local.sessions.length === 0 && local.stubs.length === 0) return Promise.resolve({ moved: 0, left: 0 });
  moving ??= moveLocalToAccount(uploadToAccount, skip).finally(() => (moving = null));
  return moving;
}

export const movedMessage = (moved: number) => `Moved ${moved} ${moved === 1 ? 'session' : 'sessions'} from this device to your account.`;
