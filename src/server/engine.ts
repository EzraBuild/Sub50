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
  { type: 'CHANGE_VIDEO' | 'PLAY' | 'PAUSE' | 'SEEK' | 'QUEUE_ADD' | 'QUEUE_ADD_MANY' | 'QUEUE_REMOVE' | 'QUEUE_PLAY' | 'TRACK_ENDED' | 'VOTE_SKIP' }
>;

const ROOM_COMMANDS: ReadonlySet<string> = new Set<RoomCommand['type']>([
  'CHANGE_VIDEO', 'PLAY', 'PAUSE', 'SEEK', 'QUEUE_ADD', 'QUEUE_ADD_MANY', 'QUEUE_REMOVE', 'QUEUE_PLAY', 'TRACK_ENDED', 'VOTE_SKIP',
]);

export const isRoomCommand = (msg: ClientMessage): msg is RoomCommand => ROOM_COMMANDS.has(msg.type);

export interface EngineContext {
  /** Server time in ms. */
  now: number;
  /** Display name of the peer issuing the command (queue attribution). */
  peerName: string;
  newId: () => string;
  /** Presence id of the issuing peer (for votes). */
  peerId?: string;
  /** Ids of everyone currently in the room; only needed for VOTE_SKIP. */
  livePeerIds?: readonly string[];
}

/** Votes needed to skip: half the live listeners, rounded up, at least one. */
export const skipThreshold = (liveCount: number): number => Math.max(1, Math.ceil(liveCount / 2));

export type Outcome =
  /** Commit `state`. If `resolveTitle` is set, look that video's title up and apply it later. */
  | { kind: 'changed'; state: RoomState; resolveTitle?: string }
  /** Nothing to commit. `resend`: reply to the sender with the current state. */
  | { kind: 'unchanged'; resend: boolean }
  | { kind: 'error'; message: string };

const NOT_A_LINK = 'That does not look like a YouTube link.';
const unchanged = (resend = false): Outcome => ({ kind: 'unchanged', resend });

export function createRoom(roomId: string, hostId: string, now: number, epoch: string): RoomState {
  return {
    roomId,
    epoch,
    videoId: null,
    title: null,
    trackId: null,
    isPlaying: false,
    lastTimestamp: 0,
    updatedAt: now,
    queue: [],
    played: [],
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
  const commit = (resolveTitle?: string): Outcome => ({
    kind: 'changed',
    state: { ...s, seq: state.seq + 1 },
    ...(resolveTitle ? { resolveTitle } : {}),
  });
  const startTrack = (item: Pick<QueueItem, 'videoId' | 'title'> & { addedBy?: string }) => {
    s.played = [{ videoId: item.videoId, title: item.title, addedBy: item.addedBy ?? ctx.peerName, at: ctx.now }, ...(s.played ?? [])].slice(
      0,
      LIMITS.PLAYED_MAX,
    );
    s.skipVotes = [];
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
      return commit(videoId);
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
        return commit(item.title ? undefined : videoId);
      }
      s.queue.push(item);
      return commit(item.title ? undefined : videoId);
    }

    case 'QUEUE_ADD_MANY': {
      // Like QUEUE_ADD for each item, in one commit; stops when the queue is full.
      let resolve: string | undefined;
      let added = 0;
      for (const it of cmd.items) {
        if (s.videoId && s.queue.length >= LIMITS.QUEUE_MAX) break;
        const item: QueueItem = { id: ctx.newId(), videoId: it.videoId, title: it.title?.trim() ?? '', addedBy: ctx.peerName };
        if (!s.videoId) {
          startTrack(item);
          if (!item.title) resolve = item.videoId;
        } else {
          s.queue.push(item);
        }
        added++;
      }
      return added ? commit(resolve) : { kind: 'error', message: 'The queue is full.' };
    }

    case 'QUEUE_REMOVE': {
      const before = s.queue.length;
      s.queue = s.queue.filter((q) => q.id !== cmd.itemId);
      return s.queue.length === before ? unchanged() : commit();
    }

    case 'QUEUE_PLAY': {
      const idx = s.queue.findIndex((q) => q.id === cmd.itemId);
      if (idx === -1) return unchanged();
      const [item] = s.queue.splice(idx, 1);
      startTrack(item!);
      return commit(item!.title ? undefined : item!.videoId);
    }

    case 'TRACK_ENDED': {
      // Every peer reports the end; only the first report for the live track counts.
      if (cmd.trackId !== s.trackId || !s.isPlaying) return unchanged();
      return advance();
    }

    case 'VOTE_SKIP': {
      // A vote is for one specific track; a late vote for the previous one is ignored.
      if (!ctx.peerId || !s.trackId || cmd.trackId !== s.trackId) return unchanged();
      const live = new Set(ctx.livePeerIds ?? [ctx.peerId]);
      const before = new Set(s.skipVotes ?? []);
      const votes = new Set([...before].filter((id) => live.has(id))); // people who left don't count
      if (cmd.vote) votes.add(ctx.peerId);
      else votes.delete(ctx.peerId);
      if (votes.size >= skipThreshold(live.size)) return advance();
      if (votes.size === before.size && [...votes].every((id) => before.has(id))) return unchanged();
      s.skipVotes = [...votes];
      return commit();
    }
  }

  /** Next queued track, or park at the current position when the queue is empty. */
  function advance(): Outcome {
    const next = s.queue.shift();
    if (next) {
      startTrack(next);
      return commit(next.title ? undefined : next.videoId);
    }
    s.lastTimestamp = positionAt(s, ctx.now);
    s.isPlaying = false;
    s.updatedAt = ctx.now;
    s.skipVotes = [];
    return commit();
  }
}

/**
 * Fills in a resolved title for the current track and any queued copies that
 * still lack one. Returns null when nothing needed it (e.g. the track moved on).
 */
export function applyTitle(state: RoomState, videoId: string, title: string): RoomState | null {
  const currentNeeds = state.videoId === videoId && !state.title;
  const queueNeeds = state.queue.some((q) => q.videoId === videoId && !q.title);
  const playedNeeds = (state.played ?? []).some((p) => p.videoId === videoId && !p.title);
  if (!currentNeeds && !queueNeeds && !playedNeeds) return null;
  return {
    ...state,
    title: currentNeeds ? title : state.title,
    queue: state.queue.map((q) => (q.videoId === videoId && !q.title ? { ...q, title } : q)),
    played: (state.played ?? []).map((p) => (p.videoId === videoId && !p.title ? { ...p, title } : p)),
    seq: state.seq + 1,
  };
}

/** New state with a different host, or null if it's already that peer. */
export function withHost(state: RoomState, hostId: string): RoomState | null {
  return state.hostId === hostId ? null : { ...state, hostId, seq: state.seq + 1 };
}
