import { auth } from '@clerk/nextjs/server';
import { authEnabled } from '../../../../../lib/auth-config';
import { handlePlaylist } from '../../../../../server/accounts/playlists';
import { accountStores } from '../../../../../server/accounts/store';

export const dynamic = 'force-dynamic';

/** Save someone's shared playlist (or your own) as a new private playlist of yours. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!authEnabled) return Response.json({ error: 'Accounts are not enabled on this server.' }, { status: 404 });
  const [{ id }, { userId }] = await Promise.all([params, auth()]);
  const body = (await req.json().catch(() => null)) as { ownerName?: unknown } | null;
  const ownerName = typeof body?.ownerName === 'string' ? body.ownerName : undefined;
  const result = await handlePlaylist('POST', userId ? { id: userId } : null, accountStores().playlists, id, { copy: true, ownerName });
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}
