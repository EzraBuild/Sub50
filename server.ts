/**
 * Sub50 server: Next.js (pages, assets, dev HMR) and the WebSocket sync channel
 * on a single port, so desktop and phones need exactly one URL.
 *
 *   npm run dev  → tsx watch server.ts --dev
 *   npm start    → node dist/server.js        (after `npm run build`)
 */
import { createServer } from 'node:http';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { SyncHub } from './src/server/hub';
import { getLanAddresses } from './src/server/net';
import { attachSocket } from './src/server/socket';
import { MemoryStore } from './src/server/store/memory';
import { resolveTitle } from './src/server/titles';

const dev = process.argv.includes('--dev');
// Next and React choose dev/prod builds from NODE_ENV, so pin it before loading them.
if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: dev ? 'development' : 'production' });
const { default: next } = await import('next');

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
/** Same path the Vercel Function serves (src/app/api/ws/route.ts), so the client never cares where it runs. */
const SYNC_PATH = '/api/ws';

// One process holds every socket, so rooms can live in memory here.
const hub = new SyncHub({ store: new MemoryStore(), resolveTitle });
hub.start();

// ---------------------------------------------------------------------------
// HTTP: Next.js handles everything except the health probe
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), ...hub.stats() }));
    return;
  }
  void handle(req, res);
});

// On the first request Next attaches its own `upgrade` listener (the one that serves dev
// HMR) to whatever `httpServer` it was given. On the real server it would also end our
// /api/ws sockets, because a route matches that path. So Next gets a decoy server that
// never listens, and we forward only Next's own paths to it.
// (`app.getUpgradeHandler()` is not a substitute: it skips the HMR handling.)
const nextUpgrades = createServer();
const app = next({ dev, hostname: 'localhost', port: PORT, httpServer: nextUpgrades });
const handle = app.getRequestHandler();
await app.prepare();

// ---------------------------------------------------------------------------
// WebSocket sync channel
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const path = req.url?.split('?')[0] ?? '';
  if (path === SYNC_PATH) {
    wss.handleUpgrade(req, socket, head, (ws) => attachSocket(hub, ws, { lanAddresses: getLanAddresses }));
  } else if (path.startsWith('/_next/') && nextUpgrades.listenerCount('upgrade') > 0) {
    nextUpgrades.emit('upgrade', req, socket, head); // dev HMR, handled by Next's own listener
  } else {
    socket.destroy(); // nothing else speaks WebSocket here; don't leave it hanging
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

server.listen(PORT, HOST, async () => {
  const [best, ...others] = getLanAddresses();
  console.log('');
  console.log(bold(`  ◉ Sub50 ${dev ? 'dev' : 'production'} server on ${HOST}:${PORT}`) + dim(`  (sync socket: ${SYNC_PATH})`));
  console.log(`  Desktop:  ${green(`http://localhost:${PORT}`)}`);
  if (best) {
    console.log(`  Phone:    ${bold(green(`http://${best}:${PORT}`))}`);
    for (const ip of others) console.log(dim(`            http://${ip}:${PORT}`));
    if (dev) {
      console.log('');
      console.log(await QRCode.toString(`http://${best}:${PORT}`, { type: 'terminal', small: true }));
      console.log(dim('  Phone must be on the same Wi-Fi. On Windows, allow Node.js through the firewall'));
      console.log(dim('  (Private networks) the first time, or the phone will just time out.'));
    }
  }
  console.log('');
});

function shutdown() {
  hub.stop();
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
