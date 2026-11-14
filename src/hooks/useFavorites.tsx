'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Favorite } from '../server/accounts/favorites';

export interface FavoritesApi {
  /** False when accounts are off on this server: hide every favorites affordance. */
  enabled: boolean;
  signedIn: boolean;
  items: Favorite[];
  has: (videoId: string) => boolean;
  toggle: (videoId: string, title: string) => void;
}

const OFF: FavoritesApi = { enabled: false, signedIn: false, items: [], has: () => false, toggle: () => {} };
const Ctx = createContext<FavoritesApi>(OFF);

export const useFavorites = () => useContext(Ctx);

/** Loads the signed-in user's favorites and keeps them in sync (optimistic, rolls back on failure). */
export function FavoritesProvider({ children, onError }: { children: ReactNode; onError: (message: string) => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [items, setItems] = useState<Favorite[]>([]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setItems([]);
      return;
    }
    let alive = true;
    fetch('/api/favorites', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { favorites?: Favorite[] } | null) => alive && d?.favorites && setItems(d.favorites))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isLoaded, isSignedIn]);

  const toggle = useCallback(
    (videoId: string, title: string) => {
      setItems((prev) => {
        const had = prev.some((f) => f.videoId === videoId);
        const next = had ? prev.filter((f) => f.videoId !== videoId) : [{ videoId, title, at: Date.now() }, ...prev];
        const request = had
          ? fetch(`/api/favorites?videoId=${encodeURIComponent(videoId)}`, { method: 'DELETE' })
          : fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId, title }) });
        request
          .then(async (r) => {
            if (r.ok) return;
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? 'Could not update favorites.');
          })
          .catch((err: Error) => {
            setItems(prev); // roll back
            onError(err.message);
          });
        return next;
      });
    },
    [onError],
  );

  const api = useMemo<FavoritesApi>(
    () => ({ enabled: true, signedIn: !!isSignedIn, items, has: (id) => items.some((f) => f.videoId === id), toggle }),
    [isSignedIn, items, toggle],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
