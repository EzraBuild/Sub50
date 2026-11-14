'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from '../icons';

/** Browser-only like the room (hash tabs, local storage, Clerk session). */
const ActivityPage = dynamic(() => import('./ActivityPage'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  ),
});

export function ActivityShell() {
  return <ActivityPage />;
}
