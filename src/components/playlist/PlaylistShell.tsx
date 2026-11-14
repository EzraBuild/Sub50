'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from '../icons';

const PlaylistPage = dynamic(() => import('./PlaylistPage'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  ),
});

export function PlaylistShell({ id }: { id: string }) {
  return <PlaylistPage id={id} />;
}
