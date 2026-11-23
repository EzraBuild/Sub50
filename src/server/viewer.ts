import { auth, clerkClient } from '@clerk/nextjs/server';
import { authEnabled } from '../lib/auth-config';
import { allowedEmail, inForce, normalizeEmail, ownerEmails, passSecret, signPass } from './access';
import { accountStores } from './accounts/store';

export interface Viewer {
  userId: string;
  /** Verified email addresses only: an unverified one could be anybody's. */
  emails: string[];
}

const TTL_MS = 5 * 60_000;
const g = globalThis as typeof globalThis & { __sub50Viewers?: Map<string, { at: number; emails: string[] }> };

/** The signed-in account and its verified emails (cached a few minutes), or null when signed out. */
export async function currentViewer(): Promise<Viewer | null> {
  if (!authEnabled) return null;
  const { userId } = await auth();
  if (!userId) return null;
  const cache = (g.__sub50Viewers ??= new Map());
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return { userId, emails: hit.emails };
  const user = await (await clerkClient()).users.getUser(userId);
  const emails = user.emailAddresses.filter((e) => e.verification?.status === 'verified').map((e) => normalizeEmail(e.emailAddress));
  if (cache.size > 1000) cache.clear();
  cache.set(userId, { at: Date.now(), emails });
  return { userId, emails };
}

export type RoomAccess = { locked: false; pass: string | null } | { locked: true; signedIn: boolean; email: string | null };

/** The room page's question: may this visitor in, and with which pass for the socket? */
export async function roomAccess(): Promise<RoomAccess> {
  if (!authEnabled) return { locked: false, pass: null };
  const owners = ownerEmails();
  if (owners.length === 0) return { locked: false, pass: null };
  const state = await accountStores().access.get();
  if (!inForce(state, owners)) return { locked: false, pass: null };
  const viewer = await currentViewer();
  if (!viewer) return { locked: true, signedIn: false, email: null };
  const email = allowedEmail(viewer.emails, state, owners);
  const secret = passSecret();
  if (!email || !secret) return { locked: true, signedIn: true, email: viewer.emails[0] ?? null };
  return { locked: false, pass: signPass(email, secret) };
}
