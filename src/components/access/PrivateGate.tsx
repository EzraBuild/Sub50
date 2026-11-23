'use client';

import { SignInButton, SignOutButton } from '@clerk/nextjs';
import { LockIcon, LogoMark } from '../icons';

/** What everyone but the owner and allowed accounts sees while Sub50 is invite-only. */
export function PrivateGate({ signedIn, email }: { signedIn: boolean; email: string | null }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 py-16 text-center">
      <LogoMark size={36} />
      <p className="label mt-8 flex items-center gap-2">
        <LockIcon size={13} />
        invite-only
      </p>
      <h1 className="mt-3 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-[34px]">Sub50 is private for now.</h1>
      <p className="mt-3 max-w-sm text-[14.5px] text-muted">Ask the owner for access.</p>
      {signedIn ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          {email && (
            <p className="font-mono text-[12px] text-faint">
              signed in as <span className="text-ink-2">{email}</span>, which isn’t on the list yet
            </p>
          )}
          <SignOutButton>
            <button type="button" className="btn h-10 px-4 text-xs">
              Use another account
            </button>
          </SignOutButton>
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center gap-3">
          <SignInButton mode="modal">
            <button type="button" className="btn-primary h-10 px-5 text-sm">
              Sign in
            </button>
          </SignInButton>
          <p className="font-mono text-[11px] text-faint">already allowed? sign in with that account</p>
        </div>
      )}
    </div>
  );
}
