import { authEnabled } from '../../../lib/auth-config';
import { handleAccessAdmin, ownerEmails } from '../../../server/access';
import { accountStores } from '../../../server/accounts/store';
import { currentViewer } from '../../../server/viewer';

export const dynamic = 'force-dynamic';

/** The owner's invite-only controls: GET the state, POST { private | allow | remove }. */
async function respond(req: Request, method: string): Promise<Response> {
  if (!authEnabled) return Response.json({ error: 'Accounts are not enabled on this server.' }, { status: 404 });
  const body = method === 'POST' ? await req.json().catch(() => null) : undefined;
  const result = await handleAccessAdmin(method, await currentViewer(), accountStores().access, ownerEmails(), body);
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}

export const GET = (req: Request) => respond(req, 'GET');
export const POST = (req: Request) => respond(req, 'POST');
