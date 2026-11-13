import type { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/protocol';
import { newId, type SyncHub } from './hub';
import { parseClientMessage } from './validate';

export interface AttachOptions {
  /** Server clock (ms). Wall clock, so every instance agrees. */
  now?: () => number;
  /** Sent in WELCOME so a localhost tab can build a phone link. Empty when hosted. */
  lanAddresses?: () => string[];
  heartbeatMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Wires one WebSocket to the hub: WELCOME, PING/PONG clock sync, a flood guard,
 * a protocol heartbeat, and cleanup. Used by the self-hosted server and the
 * Vercel Function alike.
 */
export function attachSocket(hub: SyncHub, ws: WebSocket, opts: AttachOptions = {}): void {
  const now = opts.now ?? Date.now;
  const onError = opts.onError ?? ((err: unknown) => console.error('[sync]', err));
  const id = newId();
  const send = (frame: string) => {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  };

  hub.connect({ id, send });
  const welcome: ServerMessage = { type: 'WELCOME', clientId: id, serverTime: now(), lanAddresses: opts.lanAddresses?.() ?? [] };
  send(JSON.stringify(welcome));

  // Crude flood guard: 60 frames/sec sustained is far beyond normal use.
  let budget = 120;
  const refill = setInterval(() => (budget = Math.min(120, budget + 60)), 1000);

  // Drop sockets that stop answering (phones that slept, dead NAT).
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, opts.heartbeatMs ?? 15_000);

  // Hub calls are async; chain them so one socket's commands apply in order
  // (a JOIN_ROOM must finish before the PLAY right behind it).
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task).catch(onError);
  };

  ws.on('message', (data, isBinary) => {
    const receivedAt = now(); // stamp before any parsing work so PONG is as tight as possible
    if (isBinary || --budget < 0) return;
    const msg = parseClientMessage(data.toString());
    if (!msg) return;
    if (msg.type === 'PING') {
      send(JSON.stringify({ type: 'PONG', clientTime: msg.clientTime, serverTime: receivedAt } satisfies ServerMessage));
      return;
    }
    enqueue(() => hub.handle(id, msg));
  });

  ws.on('close', () => {
    clearInterval(refill);
    clearInterval(heartbeat);
    enqueue(() => hub.disconnect(id));
  });
  ws.on('error', () => ws.terminate());
}
