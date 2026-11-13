import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/protocol';
import { getLanAddresses } from './net';
import { RoomManager, newId } from './rooms';
import { resolveTitle } from './titles';
import { parseClientMessage } from './validate';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_DIST = process.env.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist', import.meta.url));
const serveClient = existsSync(join(CLIENT_DIST, 'index.html'));

/** Monotonic, high-resolution server clock (ms). Immune to NTP steps mid-session. */
const now = () => performance.timeOrigin + performance.now();

const rooms = new RoomManager({ now, resolveTitle });

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), ...rooms.stats() });
});

if (serveClient) {
  app.use(
    express.static(CLIENT_DIST, {
      index: false,
      setHeaders(res, path) {
        // Vite fingerprints everything under /assets, so it can be cached forever.
        const immutable = path.startsWith(join(CLIENT_DIST, 'assets'));
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  // SPA fallback: any other GET serves the app shell (rooms live in ?room=).
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
}

const server = createServer(app);

// ---------------------------------------------------------------------------
// WebSocket sync channel
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws) => {
  const id = newId();
  ws.binaryType = 'nodebuffer';
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  rooms.connect({
    id,
    send(data) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
  });

  const welcome: ServerMessage = { type: 'WELCOME', clientId: id, serverTime: now(), lanAddresses: getLanAddresses() };
  ws.send(JSON.stringify(welcome));

  // Crude flood guard: 60 frames/sec sustained is far beyond normal use.
  let budget = 120;
  const refill = setInterval(() => (budget = Math.min(120, budget + 60)), 1000);

  ws.on('message', (data, isBinary) => {
    const receivedAt = now(); // stamp before any parsing work so PONG is as tight as possible
    if (isBinary || --budget < 0) return;
    const msg = parseClientMessage(data.toString());
    if (!msg) return;
    if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', clientTime: msg.clientTime, serverTime: receivedAt } satisfies ServerMessage));
      return;
    }
    rooms.handle(id, msg);
  });

  ws.on('close', () => {
    clearInterval(refill);
    rooms.disconnect(id);
  });
  ws.on('error', () => ws.terminate());
});

// Protocol-level heartbeat: drop sockets that stop answering (phones that slept, dead NAT).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 15_000);

const housekeeping = setInterval(() => rooms.flushPeers(), 1000);
const sweeper = setInterval(() => rooms.sweep(), 60_000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

server.listen(PORT, HOST, () => {
  const lan = getLanAddresses();
  console.log(`\n  Sub50 sync server listening on ${HOST}:${PORT}  (ws path /ws)`);
  if (serveClient) {
    console.log(`  Local:   http://localhost:${PORT}`);
    for (const ip of lan) console.log(`  Network: http://${ip}:${PORT}`);
  } else {
    console.log('  No client build found, so only the API and WebSocket are served (dev mode).');
  }
  console.log('');
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(housekeeping);
  clearInterval(sweeper);
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
