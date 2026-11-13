/**
 * Pure room state machine: `(state, command, context) → outcome`.
 *
 * No sockets, clocks or storage live here, so the same transitions run against
 * an in-memory room or inside a Redis compare-and-swap loop. Inputs are never
 * mutated; every committed change returns a new state whose `seq` (the room's
 * version number) is exactly one higher.
 */
import { LIMITS, SYNC, type ClientMessage, type QueueItem, type RoomState } from '../shared/protocol';
import { parseYouTubeId } from '../shared/youtube';

export type RoomCommand = Extract<
  ClientMessage,
  { type: 'CHANGE_VIDEO' | 'PLAY' | 'PAUSE' | 'SEEK' | 'QUEUE_ADD' | 'QUEUE_REMOVE' | 'QUEUE_PLAY' | 'TRACK_ENDED' }
>;

const ROOM_COMMANDS: ReadonlySet<string> = new Set<RoomCommand['type']>([
  'CHANGE_VIDEO', 'PLAY', 'PAUSE', 'SEEK', 'QUEUE_ADD', 'QUEUE_REMOVE', 'QUEUE_PLAY', 'TRACK_ENDED',
]);

export const isRoomCommand = (msg: ClientMessage): msg is RoomCommand => ROOM_COMMANDS.has(msg.type);

export interface EngineContext {
  /** Server time in ms. */
  now: number;
  /** Display name of the peer issuing the command (queue attribution). */
  peerName: string;
  newId: () => string;
}

export type Outcome =
  /** Commit `state`. If `resolveTitle` is set, look that video's title up and apply it later. */
  | { kind: 'changed'; state: RoomState; queueOnly: boolean; resolveTitle?: string }
  /** Nothing to commit. `resend`: reply to the sender with the current state. */
  | { kind: 'unchanged'; resend: boolean }
  | { kind: 'error'; message: string };

const NOT_A_LINK = 'That does not look like a YouTube link.';
const unchanged = (resend = false): Outcome => ({ kind: 'unchanged', resend });

export function createRoom(roomId: string, hostId: string, now: number): RoomState {
  return {
    roomId,
    videoId: null,
    title: null,
    trackId: null,
    isPlaying: false,
    lastTimestamp: 0,
    updatedAt: now,
    queue: [],
    hostId,
    seq: 0,
  };
}

/** Room position at server time `now` (seconds). */
export function positionAt(s: RoomState, now: number): number {
  return s.isPlaying ? s.lastTimestamp + Math.max(0, now - s.updatedAt) / 1000 : s.lastTimestamp;
}

export function applyCommand(state: RoomState, cmd: RoomCommand, ctx: EngineContext): Outcome {
  const s = structuredClone(state);
  const commit = (queueOnly = false, resolveTitle?: string): Outcome => ({
    kind: 'changed',
    state: { ...s, seq: state.seq + 1 },
    queueOnly,
    ...(resolveTitle ? { resolveTitle } : {}),
  });
  const startTrack = (item: Pick<QueueItem, 'videoId' | 'title'>) => {
    s.videoId = item.videoId;
    s.title = item.title || null;
    s.trackId = ctx.newId();
    s.isPlaying = true;
    s.lastTimestamp = 0;
    s.updatedAt = ctx.now + SYNC.TRACK_START_DELAY_MS;
  };

  switch (cmd.type) {
    case 'CHANGE_VIDEO': {
      const videoId = parseYouTubeId(cmd.url);
      if (!videoId) return { kind: 'error', message: NOT_A_LINK };
      startTrack({ videoId, title: '' });
      return commit(false, videoId);
    }

    case 'PLAY': {
      // Already playing: re-sending the state is enough. Letting one (possibly
      // drifted) client re-anchor everyone would cause a room-wide jump.
      if (s.isPlaying || !s.videoId) return unchanged(true);
      s.isPlaying = true;
      s.lastTimestamp = cmd.timestamp;
      s.updatedAt = ctx.now + SYNC.START_DELAY_MS;
      return commit();
    }

    case 'PAUSE': {
      if (!s.videoId) return unchanged();
      s.isPlaying = false;
      s.lastTimestamp = cmd.timestamp;
      s.updatedAt = ctx.now;
      return commit();
    }

    case 'SEEK': {
      if (!s.videoId) return unchanged();
      s.lastTimestamp = cmd.timestamp;
      s.updatedAt = ctx.now + (s.isPlaying ? SYNC.START_DELAY_MS : 0);
      return commit();
    }

    case 'QUEUE_ADD': {
      const videoId = parseYouTubeId(cmd.url);
      if (!videoId) return { kind: 'error', message: NOT_A_LINK };
      if (s.queue.length >= LIMITS.QUEUE_MAX) return { kind: 'error', message: 'The queue is full.' };
      const item: QueueItem = { id: ctx.newId(), videoId, title: cmd.title?.trim() ?? '', addedBy: ctx.peerName };
      // Nothing playing yet: "+ Queue" should just start the track.
      if (!s.videoId) {
        startTrack(item);
        return commit(false, item.title ? undefined : videoId);
      }
      s.queue.push(item);
      return commit(true, item.title ? undefined : videoId);
    }

    case 'QUEUE_REMOVE': {
      const before = s.queue.length;
      s.queue = s.queue.filter((q) => q.id !== cmd.itemId);
      return s.queue.length === before ? unchanged() : commit(true);
    }

    case 'QUEUE_PLAY': {
      const idx = s.queue.findIndex((q) => q.id === cmd.itemId);
      if (idx === -1) return unchanged();
      const [item] = s.queue.splice(idx, 1);
      startTrack(item!);
      return commit(false, item!.title ? undefined : item!.videoId);
    }

    case 'TRACK_ENDED': {
      // Every peer reports the end; only the first report for the live track counts.
      if (cmd.trackId !== s.trackId || !s.isPlaying) return unchanged();
      const next = s.queue.shift();
      if (next) {
        startTrack(next);
        return commit(false, next.title ? undefined : next.videoId);
      }
      // Queue exhausted: park at the end of the track.
      s.lastTimestamp = positionAt(s, ctx.now);
      s.isPlaying = false;
      s.updatedAt = ctx.now;
      return commit();
    }
  }
}

/**
 * Fills in a resolved title for the current track and any queued copies that
 * still lack one. Returns null when nothing needed it (e.g. the track moved on).
 */
export function applyTitle(state: RoomState, videoId: string, title: string): { state: RoomState; queueOnly: boolean } | null {
  const currentNeeds = state.videoId === videoId && !state.title;
  const queueNeeds = state.queue.some((q) => q.videoId === videoId && !q.title);
  if (!currentNeeds && !queueNeeds) return null;
  return {
    state: {
      ...state,
      title: currentNeeds ? title : state.title,
      queue: state.queue.map((q) => (q.videoId === videoId && !q.title ? { ...q, title } : q)),
      seq: state.seq + 1,
    },
    queueOnly: !currentNeeds,
  };
}

/** New state with a different host, or null if it's already that peer. */
export function withHost(state: RoomState, hostId: string): RoomState | null {
  return state.hostId === hostId ? null : { ...state, hostId, seq: state.seq + 1 };
}
