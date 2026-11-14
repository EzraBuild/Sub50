'use client';

import { Show, SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { authEnabled } from '../lib/auth-config';
import { HistoryIcon } from './icons';

/** The account's display name, or null while loading / signed out. */
function accountName(user: ReturnType<typeof useUser>['user']): string | null {
  if (!user) return null;
  return user.fullName || user.username || user.firstName || user.primaryEmailAddress?.emailAddress.split('@')[0] || null;
}

/** The signed-in account's display name (null while loading or signed out). Needs ClerkProvider. */
export function useAccountName(): string | null {
  const { user, isLoaded } = useUser();
  return isLoaded ? accountName(user) : null;
}

/** Header cell: "Sign in" or the account menu. Renders nothing when accounts are off. */
export function AccountButton() {
  if (!authEnabled) return null;
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="inline-flex h-9 items-center rounded-md px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-sunken">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <span className="inline-flex size-9 items-center justify-center">
          <AccountMenu />
        </span>
      </Show>
    </>
  );
}

/** Clerk's account menu, plus a way to your activity page. */
function AccountMenu() {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link label="Your activity" labelIcon={<HistoryIcon size={16} />} href="/me" />
      </UserButton.MenuItems>
    </UserButton>
  );
}

/**
 * Reports the signed-in account's name (and again whenever it changes), so the
 * room uses it. Mount only when accounts are enabled.
 */
export function AccountNameSync({ onName }: { onName: (name: string) => void }) {
  const { user, isLoaded } = useUser();
  const name = isLoaded ? accountName(user) : null;
  useEffect(() => {
    if (name) onName(name);
  }, [name, onName]);
  return null;
}

/** Gate footer line: who you're signed in as, or an invitation to sign in. */
export function GateAccount() {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return <span className="font-mono text-[11px] text-faint">checking account…</span>;
  const name = accountName(user);
  return name ? (
    <span className="font-mono text-[11px] text-muted">
      signed in as <span className="text-ink-2">{name}</span>
    </span>
  ) : (
    <SignInButton mode="modal">
      <button type="button" className="font-mono text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
        sign in to keep favorites &amp; history
      </button>
    </SignInButton>
  );
}
