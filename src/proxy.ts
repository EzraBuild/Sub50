import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { authEnabled } from './lib/auth-config';

// Attaches the Clerk session to requests so route handlers can call auth().
// Nothing is protected here: rooms stay open to guests, and each account API
// checks auth() itself. Without Clerk keys (self-host / CI) this is a no-op.
export default authEnabled ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything except Next internals, static files, and the sync socket
    // (WebSocket upgrades must reach /api/ws untouched).
    '/((?!_next|api/ws|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
