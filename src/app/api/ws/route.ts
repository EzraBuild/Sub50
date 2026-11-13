import { upgradeWebSocket } from '@vercel/functions';
import { getHostedHub } from '../../../server/hosted';
import { attachSocket } from '../../../server/socket';

/**
 * The sync socket on Vercel. A Function can hold a WebSocket open until its max
 * duration (300s on Hobby); then Vercel closes it, the client reconnects within
 * ~100ms with the same session id, and playback never stops (it runs on the
 * local clock in between).
 *
 * Self-hosted, server.ts answers this path itself and this route is never hit.
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const hub = getHostedHub();
  return upgradeWebSocket((ws) => attachSocket(hub, ws), { maxPayload: 16 * 1024 });
}
