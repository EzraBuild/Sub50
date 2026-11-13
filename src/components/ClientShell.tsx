'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from './icons';

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

export function ClientShell({ roomId }: { roomId: string }) {
  return <Sub50App roomId={roomId} />;
}
