'use client';

import { SignInButton } from '@clerk/nextjs';
import { useFavorites } from '../hooks/useFavorites';
import { HeartIcon } from './icons';

/** ❤️ for the track on the deck. Signed out, it opens sign-in instead. */
export function FavoriteButton({ videoId, title }: { videoId: string | null; title: string }) {
  const fav = useFavorites();
  if (!fav.enabled || !videoId) return null;
  const on = fav.has(videoId);
  const button = (
    <button
      type="button"
      onClick={fav.signedIn ? () => fav.toggle(videoId, title) : undefined}
      aria-pressed={on}
      aria-label={on ? 'Remove from favorites' : 'Save to favorites'}
      title={fav.signedIn ? (on ? 'Saved — click to remove' : 'Save to favorites') : 'Sign in to save favorites'}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition active:scale-90 ${
        on ? 'border-bad/40 bg-bad/10 text-bad' : 'border-line bg-sunken text-muted hover:border-line-strong hover:text-ink'
      }`}
    >
      <HeartIcon size={17} filled={on} />
    </button>
  );
  return fav.signedIn ? button : <SignInButton mode="modal">{button}</SignInButton>;
}
