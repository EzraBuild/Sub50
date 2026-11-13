import { LIMITS } from './protocol';

const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Normalised room id from untrusted input (e.g. `?room=`), or null if it isn't one. */
export function parseRoomId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return LIMITS.ROOM_ID.test(id) ? id : null;
}

/** Short, unambiguous, shareable id like `k7m-q2x`. */
export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`;
}
