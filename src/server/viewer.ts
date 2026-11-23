import { auth, clerkClient } from '@clerk/nextjs/server';
import { authEnabled } from '../lib/auth-config';
import { normalizeEmail } from './access';

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
