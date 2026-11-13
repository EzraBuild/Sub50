import { LIMITS, type ClientMessage, type SyncStatus } from '../shared/protocol';

const STATUSES: ReadonlySet<SyncStatus> = new Set<SyncStatus>([
  'idle', 'paused', 'loading', 'holding', 'locked', 'tolerant', 'correcting', 'seeking', 'blocked', 'offline',
]);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
const time = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 60 * 60 * 24 ? v : null;
const optNum = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Parses and validates an untrusted client frame. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || typeof data.type !== 'string') return null;

  if (data.type === 'PING') {
    return typeof data.clientTime === 'number' && Number.isFinite(data.clientTime)
      ? { type: 'PING', clientTime: data.clientTime }
      : null;
  }

  const roomId = str(data.roomId, 64);
  if (roomId === null) return null;

  switch (data.type) {
    case 'JOIN_ROOM': {
      const username = str(data.username, 200);
      return username === null ? null : { type: 'JOIN_ROOM', roomId, username };
    }
    case 'CHANGE_VIDEO': {
      const url = str(data.url, LIMITS.URL_MAX);
      return url === null ? null : { type: 'CHANGE_VIDEO', roomId, url };
    }
    case 'PLAY':
    case 'PAUSE':
    case 'SEEK': {
      const timestamp = time(data.timestamp);
      return timestamp === null ? null : { type: data.type, roomId, timestamp };
    }
    case 'QUEUE_ADD': {
      const url = str(data.url, LIMITS.URL_MAX);
      if (url === null) return null;
      const title = data.title === undefined ? undefined : str(data.title, LIMITS.TITLE_MAX);
      if (title === null) return null;
      return { type: 'QUEUE_ADD', roomId, url, ...(title ? { title } : {}) };
    }
    case 'QUEUE_REMOVE':
    case 'QUEUE_PLAY': {
      const itemId = str(data.itemId, 64);
      return itemId === null ? null : { type: data.type, roomId, itemId };
    }
    case 'TRACK_ENDED': {
      const trackId = str(data.trackId, 64);
      return trackId === null ? null : { type: 'TRACK_ENDED', roomId, trackId };
    }
    case 'REPORT': {
      const driftMs = optNum(data.driftMs);
      const rttMs = optNum(data.rttMs);
      const status = data.status as SyncStatus;
      if (driftMs === undefined || rttMs === undefined || !STATUSES.has(status)) return null;
      return { type: 'REPORT', roomId, driftMs, rttMs, status };
    }
    default:
      return null;
  }
}
