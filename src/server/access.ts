import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from '@upstash/redis';

/**
 * Invite-only mode. While it's on, only the owner(s) and the accounts they allow
 * can use Sub50. Owners come from SUB50_OWNER_EMAILS (kept out of the public repo);
 * with none configured, private mode is ignored so nobody can be locked out.
 */
export interface AccessState {
  private: boolean;
  /** Allowed account emails, lowercase. */
  allowed: string[];
}

export interface AccessStore {
  get(): Promise<AccessState>;
  setPrivate(on: boolean): Promise<void>;
  allow(email: string): Promise<void>;
  remove(email: string): Promise<void>;
}

export const ALLOWED_MAX = 500;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => e.length <= 254 && EMAIL.test(e);

export function ownerEmails(raw = process.env.SUB50_OWNER_EMAILS): string[] {
  return (raw ?? '').split(',').map(normalizeEmail).filter(isEmail);
}

/** Private mode only counts with an owner who could switch it off again. */
export const inForce = (state: AccessState, owners: string[]) => state.private && owners.length > 0;

/** The first of these (verified) emails that may use Sub50, or null. */
export function allowedEmail(emails: string[], state: AccessState, owners: string[]): string | null {
  for (const raw of emails) {
    const e = normalizeEmail(raw);
    if (owners.includes(e) || state.allowed.includes(e)) return e;
  }
  return null;
}

export class RedisAccess implements AccessStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'sub50',
  ) {}
  private privateKey = () => `${this.prefix}:access:private`;
  private allowedKey = () => `${this.prefix}:access:allowed`;

  async get(): Promise<AccessState> {
    const [flag, allowed] = await Promise.all([this.redis.get<string>(this.privateKey()), this.redis.smembers(this.allowedKey())]);
    return { private: String(flag) === '1', allowed: (allowed ?? []).map(String).sort() };
  }
  async setPrivate(on: boolean) {
    if (on) await this.redis.set(this.privateKey(), '1');
    else await this.redis.del(this.privateKey());
  }
  async allow(email: string) {
    await this.redis.sadd(this.allowedKey(), email);
  }
  async remove(email: string) {
    await this.redis.srem(this.allowedKey(), email);
  }
}

export class MemoryAccess implements AccessStore {
  private on = false;
  private readonly list = new Set<string>();
  async get(): Promise<AccessState> {
    return { private: this.on, allowed: [...this.list].sort() };
  }
  async setPrivate(on: boolean) {
    this.on = on;
  }
  async allow(email: string) {
    this.list.add(email);
  }
  async remove(email: string) {
    this.list.delete(email);
  }
}

// --- passes ------------------------------------------------------------------
// The room socket isn't behind Clerk (WebSocket upgrades skip the middleware), so the
// room page hands an allowed visitor a signed pass naming their email. The socket and
// search check it against the current list, so removing someone takes effect on their
// next reconnect (within ~5 minutes on Vercel).

export const PASS_TTL_MS = 7 * 24 * 3600_000;
export const passSecret = () => process.env.SUB50_ACCESS_SECRET || process.env.CLERK_SECRET_KEY || null;

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signPass(email: string, secret: string, now = Date.now(), ttl = PASS_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({ m: email, e: now + ttl })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The email a pass was issued to, or null if it's forged, tampered with or expired. */
export function readPass(token: string | null | undefined, secret: string, now = Date.now()): string | null {
  const [payload, sig] = (token ?? '').split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { m, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { m?: unknown; e?: unknown };
    return typeof m === 'string' && typeof e === 'number' && e > now ? m : null;
  } catch {
    return null;
  }
}

/** For the room socket and search: may a request carrying this pass go ahead right now? */
export async function passAllows(token: string | null | undefined, deps: { store: AccessStore; owners: string[]; secret: string | null; now?: number }): Promise<boolean> {
  const state = await deps.store.get();
  if (!inForce(state, deps.owners)) return true;
  if (!deps.secret) return false;
  const email = readPass(token, deps.secret, deps.now);
  return !!email && allowedEmail([email], state, deps.owners) !== null;
}

// --- owner API ---------------------------------------------------------------

/** GET: the state · POST { private?: boolean, allow?: email, remove?: email }. Owners only. */
export async function handleAccessAdmin(
  method: string,
  viewer: { emails: string[] } | null,
  store: AccessStore,
  owners: string[],
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  if (!viewer) return { status: 401, body: { error: 'Sign in first.' } };
  if (!viewer.emails.some((e) => owners.includes(normalizeEmail(e)))) return { status: 403, body: { error: 'Only the owner can change access.' } };
  const view = async () => ({ ...(await store.get()), owners });
  if (method === 'GET') return { status: 200, body: await view() };
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };

  const b = (typeof body === 'object' && body !== null ? body : {}) as { private?: unknown; allow?: unknown; remove?: unknown };
  if (typeof b.private === 'boolean') await store.setPrivate(b.private);
  if (b.allow !== undefined) {
    const email = typeof b.allow === 'string' ? normalizeEmail(b.allow) : '';
    if (!isEmail(email)) return { status: 400, body: { error: 'That doesn’t look like an email address.' } };
    if ((await store.get()).allowed.length >= ALLOWED_MAX) return { status: 400, body: { error: `The list is full (${ALLOWED_MAX}).` } };
    await store.allow(email);
  }
  if (typeof b.remove === 'string') await store.remove(normalizeEmail(b.remove));
  return { status: 200, body: await view() };
}
