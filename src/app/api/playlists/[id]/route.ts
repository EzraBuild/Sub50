import { auth } from '@clerk/nextjs/server';
import { authEnabled } from '../../../../lib/auth-config';
import { handlePlaylist } from '../../../../server/accounts/playlists';
import { accountStores } from '../../../../server/accounts/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function respond(req: Request, method: string, { params }: Ctx): Promise<Response> {
  if (!authEnabled) return Response.json({ error: 'Accounts are not enabled on this server.' }, { status: 404 });
  const [{ id }, { userId }] = await Promise.all([params, auth()]);
  const body = method === 'PATCH' ? await req.json().catch(() => null) : undefined;
  const result = await handlePlaylist(method, userId ? { id: userId } : null, accountStores().playlists, id, { body });
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}

export const GET = (req: Request, ctx: Ctx) => respond(req, 'GET', ctx);
export const PATCH = (req: Request, ctx: Ctx) => respond(req, 'PATCH', ctx);
export const DELETE = (req: Request, ctx: Ctx) => respond(req, 'DELETE', ctx);
