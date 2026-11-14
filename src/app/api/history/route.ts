import { auth } from '@clerk/nextjs/server';
import { authEnabled } from '../../../lib/auth-config';
import { handleHistory } from '../../../server/accounts/history';
import { accountStores } from '../../../server/accounts/store';

export const dynamic = 'force-dynamic';

async function respond(req: Request, method: string): Promise<Response> {
  if (!authEnabled) return Response.json({ error: 'Accounts are not enabled on this server.' }, { status: 404 });
  const { userId } = await auth();
  const url = new URL(req.url);
  // sendBeacon posts with a text/plain or application/json body; read it as text either way.
  const body = method === 'POST' ? await req.text().then((t) => JSON.parse(t) as unknown).catch(() => null) : undefined;
  const result = await handleHistory(method, userId, accountStores().history, { body, sessionId: url.searchParams.get('sessionId') });
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}

export const GET = (req: Request) => respond(req, 'GET');
export const POST = (req: Request) => respond(req, 'POST');
export const DELETE = (req: Request) => respond(req, 'DELETE');
