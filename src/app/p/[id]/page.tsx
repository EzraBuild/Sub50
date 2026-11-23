import type { Metadata } from 'next';
import { authEnabled } from '../../../lib/auth-config';
import { isPlaylistId } from '../../../server/accounts/playlists';
import { accountStores } from '../../../server/accounts/store';
import { PlaylistShell } from '../../../components/playlist/PlaylistShell';
import { roomAccess } from '../../../server/viewer';

interface Props {
  params: Promise<{ id: string }>;
}

/** Shared playlists get a real title in link previews; private ones stay anonymous. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fallback: Metadata = { title: 'Playlist — Sub50' };
  if (!authEnabled || !isPlaylistId(id)) return fallback;
  const p = await accountStores()
    .playlists.get(id)
    .catch(() => null);
  if (!p || p.visibility !== 'link') return fallback;
  const songs = `${p.tracks.length} ${p.tracks.length === 1 ? 'song' : 'songs'}`;
  return {
    title: `${p.name} — Sub50`,
    description: `${songs} by ${p.ownerName}. Listen together in lockstep.`,
    openGraph: { title: p.name, description: `${songs} by ${p.ownerName} on Sub50` },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  // Adding songs by name uses search: only with a YouTube key, and (invite-only) a pass.
  const access = await roomAccess();
  const pass = access.locked ? null : access.pass;
  return <PlaylistShell id={id} searchEnabled={!!process.env.YOUTUBE_API_KEY && !access.locked} pass={pass} />;
}
