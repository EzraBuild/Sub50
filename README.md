# Sub50

Paste a YouTube link, and everyone in the room hears it on their own device and headphones, in lockstep, with under 50ms of drift.

No audio goes through the server. Every device runs its own YouTube IFrame player; the server only keeps one authoritative timeline and each client steers its player onto it.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · `ws`. A small custom server (`server.ts`) runs Next.js and the WebSocket sync channel in **one process on one port**.

## Quick start

Requires Node 22.12+ (Node 24 recommended).

```bash
npm install
npm run dev
```

`npm run dev` starts Next.js with hot reload and the `/ws` sync socket on port 3000, then prints the URL for phones plus a QR code:

```text
◉ Sub50 dev server on 0.0.0.0:3000  (sync socket: /ws)
Desktop:  http://localhost:3000
Phone:    http://192.168.1.23:3000
```

1. Open `http://localhost:3000` on your computer. The server redirects you to a fresh room (`/?room=abc-xyz`).
2. Click **Copy LAN Link** (or the QR button) in the header and open it on your phone. On `localhost` the link is rewritten to your LAN IP automatically.
3. Tap **Tap to Enter Sub50** on each device. This unlocks audio; mobile browsers refuse unmuted playback that doesn't start inside a tap.
4. Paste a link and hit **Play Now** or **+ Queue**.

> **Phone can't connect?** It must be on the same Wi-Fi, and on Windows the first run needs Node.js allowed through the firewall for **Private** networks. Guest or "client isolation" Wi-Fi blocks device-to-device traffic entirely.

The **Listeners** panel shows every device's drift and round-trip time, which is the quickest way to watch the room lock.

## How sync works

```mermaid
sequenceDiagram
    participant A as Device A
    participant S as Sync server
    participant B as Device B
    A->>S: PING {clientTime}
    S-->>A: PONG {clientTime, serverTime}
    Note over A: clock offset from the fastest round trips
    A->>S: PLAY {timestamp: 42}
    S-->>A: SYNC_STATE {lastTimestamp: 42, updatedAt: now + 350ms}
    S-->>B: SYNC_STATE {lastTimestamp: 42, updatedAt: now + 350ms}
    Note over A,B: both park on 0:42 and start on the same server instant
```

**Clock sync (NTP-lite).** Each round trip gives `rtt = now - clientTime` and `offset = serverTime - (clientTime + rtt/2)`. That estimate assumes the trip was symmetric, so a slow sample (busy main thread, Wi-Fi power-save wakeup) can be off by half its RTT. Sub50 keeps the last 16 samples and averages the offsets of the 3 fastest. It pings in a burst on connect, then every 2s, and again whenever the tab wakes up.

**Room timeline.** Every client computes where the room is right now:

```text
serverNow    = Date.now() + clockOffset
expectedTime = lastTimestamp + (serverNow - updatedAt) / 1000
```

PLAY, SEEK and track changes are **scheduled** slightly in the future (`updatedAt = now + 350ms`, or `+1.5s` for a new track). Devices buffer (a new track preloads muted), wait on the start line, and call `playVideo()` just early enough to hit the instant, with each device learning its own start latency. Without scheduling, every device would start whenever its packet happened to arrive.

**Drift correction.** Each device samples `player.getCurrentTime() - expectedTime` every 250ms and decides once per second from a 3-sample median:

| drift | action |
|---|---|
| < 50ms | **SUB50 LOCKED**, nothing to do |
| 50–150ms | tolerated, no correction (avoids audible artefacts) |
| 150ms–1.5s | playback rate 1.05× / 0.95× until back within ~20ms |
| > 1.5s | hard `seekTo(expected + learned seek latency)` |

Right after a load, seek or resume there is no audio continuity to protect, so the bands tighten (nudge from 50ms, seek from 250ms) to lock quickly. If a video ignores fractional rates, the engine detects it and seeks instead.

**No echo loops.** Programmatic player commands run with `isRemoteUpdateRef` raised, so the `onStateChange` they trigger is never sent back to the server. A pause that comes from you (tapping the video, lock-screen or headphone controls) is shared with the room, but only out of steady playback while the page is visible. A phone locking its screen, or a browser blocking autoplay, never pauses everyone.

**Accepted links:** `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `music.youtube.com/watch?v=`, `/embed/`, `/live/`, `youtube-nocookie.com`, or a bare 11-character id.

## Scripts

| command | does |
|---|---|
| `npm run dev` | `tsx watch server.ts --dev`: Next.js + HMR + `/ws` on :3000, prints LAN URL + QR |
| `npm test` | unit tests (URL parser, room engine, clock sync, drift bands) |
| `npm run typecheck` | `tsc --noEmit` over the whole project |
| `npm run build` | `next build` (type-checks too) + bundles `server.ts` → `dist/server.js` |
| `npm start` | production: `node dist/server.js` serves Next.js and `/ws` on `$PORT` |

In dev, phones load the site by LAN IP, so `next.config.ts` adds this machine's LAN addresses to `allowedDevOrigins`. Without that, Next blocks the HMR and dev chunks for those origins.

## Deploying

Production is one Node process: Next.js plus the WebSocket on `$PORT`, with a health check at `/healthz`.

```bash
npm run build && PORT=8080 npm start     # or:
docker build -t sub50 . && docker run -p 3000:3000 sub50
```

Room state lives **in memory**, and every peer in a room must hold a socket to the same process. So run exactly **one instance** on a host that keeps a long-lived Node process. Two replicas would split rooms between them, and a restart clears all rooms (clients reconnect and re-join automatically, but queues are lost).

That's also why this isn't a Vercel deploy: a custom server can't run there, and functions don't share in-memory rooms. Use one of these instead:

- **Railway**: deploy the repo; it detects the Dockerfile, or set build `npm run build` and start `npm start`. `PORT` is injected.
- **Render**: Web Service, build `npm ci && npm run build`, start `npm start`, health check path `/healthz`. WebSockets work on web services.
- **Fly.io**: `fly launch` (uses the Dockerfile; internal port `3000`), then `fly scale count 1`. In `fly.toml` set `auto_stop_machines = "off"` and `min_machines_running = 1` so idle rooms survive.

Behind HTTPS the client switches to `wss://` automatically. To point the client at a sync server on another host, build with `NEXT_PUBLIC_WS_URL=wss://your-server/ws`.

| env | default | used by |
|---|---|---|
| `PORT` | `3000` | server |
| `HOST` | `0.0.0.0` | server bind address |
| `NEXT_PUBLIC_WS_URL` | same origin `/ws` | client build (inlined by Next) |

## Known limits

- **Bluetooth output latency is invisible to the browser.** Two players can be locked within 10ms while one listener's earbuds add 150–250ms on top. Wired headphones (or the same model on every device) keep the audible result inside Sub50's numbers.
- **Background playback**: iOS and some Android browsers pause the YouTube embed when the screen locks. Sub50 resyncs as soon as the page is visible again; tap **Resync** if needed.
- **Embedding**: some uploads (often official music videos) disallow embedding and show an error in the deck. Try another upload.
- **Access**: no accounts. Anyone with the room link can control playback, by design for a shared jam on your own network.

## Layout

```text
server.ts            custom server: Next.js handler, /ws sync socket, /healthz, LAN banner
next.config.ts       allowedDevOrigins (LAN IPs), Turbopack root
src/
├── app/             App Router: layout (Geist, viewport), page (server-side ?room= redirect), globals.css
├── components/      ClientShell (ssr: false) → Sub50App, deck, scrubber, queue, gate, telemetry pill
├── hooks/           useYouTubeSync (drift engine), useRoom (socket → React state)
├── lib/             clock sync, reconnecting socket client, drift math, YouTube API loader
├── server/          RoomManager, message validation, oEmbed titles, LAN detection
└── shared/          wire protocol + sync tunables, YouTube URL parser, room ids
```

The player is a client component loaded with `ssr: false`, because it needs the YouTube IFrame API, the autoplay unlock and `localStorage`. The page itself is a server component that validates `?room=` and redirects to a fresh room before any JavaScript runs.
