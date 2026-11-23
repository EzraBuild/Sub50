'use client';

import dynamic from 'next/dynamic';
import { LogoMark } from '../icons';
import { setAccessPass } from '../../lib/accessPass';
import { setSearchEnabled } from '../../lib/songSearch';

const PlaylistPage = dynamic(() => import('./PlaylistPage'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  ),
});

export function PlaylistShell({ id, searchEnabled, pass }: { id: string; searchEnabled: boolean; pass: string | null }) {
  setAccessPass(pass); // search carries it while Sub50 is invite-only
  setSearchEnabled(searchEnabled);
  return <PlaylistPage id={id} />;
}
