/**
 * Sub50 wire protocol, shared by server and client.
 *
 * Time model
 * ----------
 * The server is the only clock that matters. `updatedAt` is the server time (ms)
 * at which the playhead is (or will be) exactly `lastTimestamp` seconds. While
 * `isPlaying`, every client derives the room position as
 *
 *   expectedTime = lastTimestamp + max(0, serverNow - updatedAt) / 1000
 *
 * `updatedAt` may sit slightly in the future: PLAY / SEEK / track changes are
 * scheduled a few hundred ms ahead so every client gets the message, buffers,
 * and starts on the same instant instead of "whenever the packet arrives".
 */

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
}

export interface RoomState {
  roomId: string;
  videoId: string | null;
  /** Title of the current track (resolved via oEmbed; null until known). */
  title: string | null;
  /** Unique per track start; lets the server ignore duplicate TRACK_ENDED reports. */
  trackId: string | null;
  isPlaying: boolean;
  /** Video playback position in seconds at `updatedAt`. */
  lastTimestamp: number;
  /** Server time (ms) when `lastTimestamp` is / becomes the live playhead. */
  updatedAt: number;
  queue: QueueItem[];
  hostId: string;
  /** Version number: +1 on every committed change. Stores compare-and-swap on it. */
  seq: number;
  /** Random id fixed when the room is created; `seq` only orders states within one epoch. */
  epoch: string;
}

export type SyncStatus =
  | 'idle'
  | 'paused'
  | 'loading'
  | 'holding'
  | 'locked'
  | 'tolerant'
  | 'correcting'
  | 'seeking'
  | 'blocked'
  | 'offline';

export interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  /** Signed drift in ms (positive = ahead of the room). Null when not playing. */
  driftMs: number | null;
  rttMs: number | null;
  status: SyncStatus;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'PING'; clientTime: number }
  /** `sessionId`: stable per browser tab, so a reconnect is the same peer (and keeps host). */
  | { type: 'JOIN_ROOM'; roomId: string; username: string; sessionId?: string }
  | { type: 'CHANGE_VIDEO'; roomId: string; url: string }
  | { type: 'PLAY'; roomId: string; timestamp: number }
  | { type: 'PAUSE'; roomId: string; timestamp: number }
  | { type: 'SEEK'; roomId: string; timestamp: number }
  | { type: 'QUEUE_ADD'; roomId: string; url: string; title?: string }
  | { type: 'QUEUE_REMOVE'; roomId: string; itemId: string }
  | { type: 'QUEUE_PLAY'; roomId: string; itemId: string }
  | { type: 'TRACK_ENDED'; roomId: string; trackId: string }
  | { type: 'REPORT'; roomId: string; driftMs: number | null; rttMs: number | null; status: SyncStatus };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'WELCOME'; clientId: string; serverTime: number; lanAddresses: string[] }
  | { type: 'PONG'; clientTime: number; serverTime: number }
  | { type: 'SYNC_STATE'; state: RoomState }
  | { type: 'PEERS'; roomId: string; peers: Peer[] }
  /** One peer's telemetry changed; cheaper than re-sending the whole list. */
  | { type: 'PEER_UPDATE'; roomId: string; peer: Peer }
  | { type: 'ERROR'; message: string };

// ---------------------------------------------------------------------------
// Tunables shared by both sides
// ---------------------------------------------------------------------------

export const SYNC = {
  /** PLAY / SEEK are scheduled this far ahead so all peers start together. */
  START_DELAY_MS: 350,
  /** Track changes are scheduled further ahead so phones (slower to buffer) start on time too. */
  TRACK_START_DELAY_MS: 2500,
  /** Drift bands (seconds). */
  LOCK_S: 0.05,
  TOLERANCE_S: 0.15,
  /**
   * Beyond this, seek instead of nudging. The spec said 1.5s, but closing 500ms at
   * ±5% takes ~10s of audibly-off playback, and phones showed exactly that.
   */
  HARD_SEEK_S: 0.6,
  /** Nudges stop once drift is back under this (well inside LOCK). */
  NUDGE_TARGET_S: 0.02,
  /** ±5% rate nudge, or ±10% when drift is above STRONG_NUDGE_S, so no nudge lasts much past 5s. */
  NUDGE: 0.05,
  NUDGE_STRONG: 0.1,
  STRONG_NUDGE_S: 0.3,
  /** A nudge must move drift by at least this share of what its rate implies, or it's ignored by the player. */
  NUDGE_MIN_EFFECT: 0.4,
  /** How long a nudge runs before we judge whether it is actually working. */
  NUDGE_VERIFY_MS: 2000,
} as const;

export const LIMITS = {
  ROOM_ID: /^[a-z0-9-]{3,32}$/,
  NAME_MAX: 24,
  URL_MAX: 512,
  TITLE_MAX: 200,
  QUEUE_MAX: 200,
} as const;
