'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ListeningSession, PersonSummary } from '../server/accounts/history';
import { flushListening } from './useListeningTracker';

export interface HistoryData {
  sessions: ListeningSession[];
  people: PersonSummary[];
}

export interface HistoryApi {
  enabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Null while loading. */
  data: HistoryData | null;
  remove: (sessionId: string) => void;
}

const OFF: HistoryApi = { enabled: false, isOpen: false, open: () => {}, close: () => {}, data: null, remove: () => {} };
const Ctx = createContext<HistoryApi>(OFF);
export const useHistory = () => useContext(Ctx);

/** Loads the history panel's data on demand. Mount only when accounts are enabled. */
export function HistoryProvider({ children, onError }: { children: ReactNode; onError: (message: string) => void }) {
  const { isSignedIn } = useAuth();
  const [isOpen, setOpen] = useState(false);
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    if (!isOpen || !isSignedIn) return;
    let alive = true;
    setData(null);
    // Push the live visit first so it shows up in the list.
    flushListening()
      .then(() => fetch('/api/history', { cache: 'no-store' }))
      .then((r) => (r.ok ? (r.json() as Promise<HistoryData>) : Promise.reject(new Error('Could not load your history.'))))
      .then((d) => alive && setData(d))
      .catch((err: Error) => {
        if (!alive) return;
        setData({ sessions: [], people: [] });
        onError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, isSignedIn, onError]);

  const remove = useCallback(
    (sessionId: string) => {
      setData((prev) => (prev ? { ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) } : prev));
      fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
        .then((r) => {
          if (!r.ok) throw new Error();
        })
        .catch(() => onError('Could not remove that session.'));
    },
    [onError],
  );

  const api = useMemo<HistoryApi>(
    () => ({ enabled: true, isOpen, open: () => setOpen(true), close: () => setOpen(false), data, remove }),
    [isOpen, data, remove],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
