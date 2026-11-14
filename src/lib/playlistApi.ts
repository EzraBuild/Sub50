import type { PlaylistSummary, PublicPlaylist, Visibility } from '../server/accounts/playlists';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(body.error ?? 'Something went wrong.'), { status: r.status });
  return body;
}

export type PlaylistOp =
  | { op: 'update'; name?: string; description?: string; visibility?: Visibility }
  | { op: 'add'; videoId: string; title: string }
  | { op: 'remove'; videoId: string }
  | { op: 'move'; from: number; to: number };

/** Thin client for /api/playlists. Errors carry the server's message (and status). */
export const playlistApi = {
  mine: () => call<{ playlists: PlaylistSummary[] }>('/api/playlists').then((d) => d.playlists),
  create: (input: { name: string; visibility?: Visibility; ownerName?: string; tracks?: { videoId: string; title: string }[] }) =>
    call<{ playlist: PublicPlaylist }>('/api/playlists', { method: 'POST', body: JSON.stringify(input) }).then((d) => d.playlist),
  get: (id: string) => call<{ playlist: PublicPlaylist }>(`/api/playlists/${encodeURIComponent(id)}`).then((d) => d.playlist),
  patch: (id: string, op: PlaylistOp) => call<{ playlist: PublicPlaylist; already?: boolean }>(`/api/playlists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(op) }),
  remove: (id: string) => call<{ ok: true }>(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  copy: (id: string, ownerName?: string) =>
    call<{ playlist: PublicPlaylist }>(`/api/playlists/${encodeURIComponent(id)}/copy`, { method: 'POST', body: JSON.stringify({ ownerName }) }).then((d) => d.playlist),
};

export const playlistPath = (id: string) => `/p/${id}`;
/** Opens a fresh room that queues the whole playlist (handled by the room, #92). */
export const playInRoomUrl = (roomId: string, playlistId: string) => `/?room=${roomId}&playlist=${playlistId}`;
