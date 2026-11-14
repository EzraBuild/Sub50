/**
 * Accounts are optional: on Vercel the Clerk Marketplace integration provides the
 * keys; self-hosted or in CI without them, Sub50 runs guest-only (no sign-in UI,
 * no account features) instead of failing to boot.
 *
 * NEXT_PUBLIC_* is inlined at build time, so this is safe in client and server code.
 */
export const authEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
