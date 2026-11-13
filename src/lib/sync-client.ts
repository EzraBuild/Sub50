import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { ClockSync, clientNow } from './clock';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

type MessageListener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

const BURST_COUNT = 8;
const BURST_GAP_MS = 60;
const STEADY_PING_MS = 2000;
/** Join once the clock is trustworthy (or after this long, whichever is first). */
const JOIN_AFTER_SAMPLES = 4;
const JOIN_TIMEOUT_MS = 800;

export function defaultSocketUrl(): string {
  // Inlined by Next at build time; set it only when the sync server lives elsewhere.
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/**
 * One WebSocket to the sync server: reconnects with backoff, keeps the clock
 * offset fresh, and (re)joins the current room whenever the socket opens.
 */
export class SyncClient {
  readonly clock = new ClockSync();
  status: ConnectionStatus = 'closed';
  clientId: string | null = null;
  lanAddresses: string[] = [];

  private ws: WebSocket | null = null;
  private running = false;
  private attempt = 0;
  private join: { roomId: string; username: string } | null = null;
  private joined = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(private readonly url: string = defaultSocketUrl()) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close(1000);
    }
    this.setStatus('closed');
  }

  setRoom(roomId: string, username: string): void {
    const changed = this.join?.roomId !== roomId || this.join?.username !== username;
    this.join = { roomId, username };
    if (this.joined) {
      if (changed) this.sendJoin(true);
    } else if (this.clock.sampleCount >= JOIN_AFTER_SAMPLES) {
      this.sendJoin();
    }
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Fire a burst of pings to re-estimate the clock offset quickly. */
  resyncClock(): void {
    for (let i = 0; i < BURST_COUNT; i++) this.later(() => this.ping(), i * BURST_GAP_MS);
  }

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  // -------------------------------------------------------------------------

  private connect(): void {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.joined = false;
      this.clock.reset();
      this.setStatus('open');
      this.resyncClock();
      this.pingInterval = setInterval(() => this.ping(), STEADY_PING_MS);
      this.later(() => this.sendJoin(), JOIN_TIMEOUT_MS);
    };

    ws.onmessage = (ev) => {
      const receivedAt = clientNow(); // before parsing, for the tightest RTT
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'PONG') {
        this.clock.addSample(msg.clientTime, msg.serverTime, receivedAt);
        if (!this.joined && this.clock.sampleCount >= JOIN_AFTER_SAMPLES) this.sendJoin();
      } else if (msg.type === 'WELCOME') {
        this.clientId = msg.clientId;
        this.lanAddresses = msg.lanAddresses;
      }
      for (const fn of this.messageListeners) fn(msg);
    };

    ws.onclose = () => {
      this.clearTimers();
      this.ws = null;
      this.joined = false;
      this.setStatus('closed');
      if (!this.running) return;
      const delay = Math.min(5000, 400 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);
      this.later(() => this.running && this.connect(), delay);
    };

    ws.onerror = () => ws.close();
  }

  private sendJoin(force = false): void {
    if ((this.joined && !force) || !this.join || this.ws?.readyState !== WebSocket.OPEN) return;
    this.joined = true;
    this.send({ type: 'JOIN_ROOM', ...this.join });
  }

  private ping(): void {
    this.send({ type: 'PING', clientTime: clientNow() });
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }
}
