import { auth } from '@clerk/nextjs/server';
import { authEnabled } from '../../../lib/auth-config';
import { handlePlaylistList } from '../../../server/accounts/playlists';
import { accountStores } from '../../../server/accounts/store';

export const dynamic = 'force-dynamic';

async function respond(req: Request, method: string): Promise<Response> {
  if (!authEnabled) return Response.json({ error: 'Accounts are not enabled on this server.' }, { status: 404 });
  const { userId } = await auth();
  const body = method === 'POST' ? await req.json().catch(() => null) : undefined;
  const result = await handlePlaylistList(method, userId ? { id: userId } : null, accountStores().playlists, body);
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}

export const GET = (req: Request) => respond(req, 'GET');
export const POST = (req: Request) => respond(req, 'POST');
