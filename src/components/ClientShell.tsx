'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from './icons';
import { setAccessPass } from '../lib/accessPass';
import { setSearchEnabled } from '../lib/songSearch';

/**
 * The player is browser-only (YouTube IFrame API, autoplay unlock, localStorage),
 * so it skips SSR entirely instead of rendering a markup shell that can't hydrate.
 */
const Sub50App = dynamic(() => import('./Sub50App'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  ),
});

export function ClientShell({ roomId, searchEnabled, pass = null }: { roomId: string; searchEnabled: boolean; pass?: string | null }) {
  setAccessPass(pass); // before the room connects: the socket and search carry it
  setSearchEnabled(searchEnabled);
  return <Sub50App roomId={roomId} searchEnabled={searchEnabled} />;
}
