import { useCallback, useRef, type RefObject } from 'react';
import { groove, grooveLevels, type Groove } from '../lib/beat';
import { useMicLevels } from '../hooks/useMicLevels';
import type { Reaction, RoomState } from '../shared/protocol';
import { AddToPlaylist } from './AddToPlaylist';
import { DotMatrix, type LevelSource } from './DotMatrix';
import { FavoriteButton } from './FavoriteButton';
import { SectionHead } from './Frame';
import { HeadphonesIcon, MicIcon, NextIcon, PauseIcon, PlayIcon, ResyncIcon, VideoIcon, VideoOffIcon } from './icons';
import { FloatingReactions, ReactionBar, type FloatingReaction } from './Reactions';
import { Scrubber } from './Scrubber';

interface Props {
  hostRef: RefObject<HTMLDivElement | null>;
  room: RoomState | null;
  duration: number;
  error: string | null;
  showVideo: boolean;
  connected: boolean;
  getPosition: () => number;
  getLoadedFraction: () => number;
  onToggleVideo: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onResync: () => void;
  /** Vote-to-skip tally for the current track. */
  skip: { votes: number; needed: number; mine: boolean };
  onVoteSkip: () => void;
  reactions: FloatingReaction[];
  onReact: (emoji: Reaction) => void;
  /** Short messages for the user (toasts). */
  notify: (message: string) => void;
}

/**
 * Audio-only: a dot-matrix meter grooving to the shared playback position (same on
 * every device), or, if you opt in, to the real sound your microphone hears.
 * Unmounting (video shown, track gone, leaving) releases the mic.
 */
function AudioOnlyArt({ videoId, playing, getPosition }: { videoId: string; playing: boolean; getPosition: () => number }) {
  const mic = useMicLevels();
  const { read } = mic;
  const cache = useRef<{ key: string; groove: Groove } | null>(null);
  const source = useCallback<LevelSource>(
    (cols) => {
      const heard = read(cols);
      if (heard) return heard;
      if (!playing) return null;
      const key = `${videoId}:${cols}`;
      if (cache.current?.key !== key) cache.current = { key, groove: groove(videoId, cols) };
      return grooveLevels(cache.current.groove, getPosition());
    },
    [read, videoId, playing, getPosition],
  );
  const listening = mic.state === 'on';
  const mode = mic.available ? (
    <button
      type="button"
      onClick={listening ? mic.stop : () => void mic.start()}
      disabled={mic.state === 'starting'}
      aria-pressed={listening}
      title={
        listening
          ? 'Reacting to what your microphone hears. Tap to go back to the synced groove.'
          : mic.state === 'blocked'
            ? 'The microphone is blocked for this site. Allow it in site settings, then tap again.'
            : mic.state === 'missing'
              ? 'No microphone available (none connected, or another app is using it). Tap to try again.'
              : 'React to the real sound: listens through your microphone (works with speakers, not headphones)'
      }
      className={`-mr-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 uppercase transition-colors hover:bg-line hover:text-ink ${listening ? 'text-bad' : ''}`}
    >
      <MicIcon size={12} />
      {{ off: 'sync', starting: 'mic…', on: 'mic', blocked: 'mic blocked', missing: 'no mic' }[mic.state]}
    </button>
  ) : (
    'sync'
  );
  return (
    <div className="h-44 border-b border-line bg-sunken px-4 pt-5 pb-3.5 sm:h-52 sm:px-6">
      <DotMatrix
        source={source}
        label={listening ? 'mic capture' : playing ? 'audio only' : 'paused'}
        mode={mode}
        status={listening ? 'rec' : playing ? 'live' : 'idle'}
      />
    </div>
  );
}

export function AudioDeck(props: Props) {
  const { hostRef, room, duration, error, showVideo, connected } = props;
  const hasTrack = !!room?.videoId;
  const playing = !!room?.isPlaying;
  const canControl = hasTrack && connected;

  return (
    <section aria-label="Audio deck" className="relative">
      <FloatingReactions reactions={props.reactions} />
      <SectionHead
        index="01"
        title="Deck"
        meta={
          <button
            type="button"
            onClick={props.onToggleVideo}
            disabled={!hasTrack}
            aria-pressed={showVideo}
            title={showVideo ? 'Hide video (saves battery and data)' : 'Show video'}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 uppercase transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
          >
            {showVideo ? <VideoOffIcon size={13} /> : <VideoIcon size={13} />}
            {showVideo ? 'hide video' : 'show video'}
          </button>
        }
      />

      {/* The iframe stays mounted when hidden (1px, transparent) so audio keeps playing,
          and YouTube drops to its lowest video quality, which saves battery and data. */}
      <div
        className={`relative w-full bg-black transition-opacity duration-300 ${
          showVideo && hasTrack ? 'aspect-video border-b border-line opacity-100' : 'pointer-events-none h-px opacity-0'
        }`}
      >
        <div ref={hostRef} className="yt-host absolute inset-0" />
      </div>

      {hasTrack && !showVideo && <AudioOnlyArt videoId={room!.videoId!} playing={playing} getPosition={props.getPosition} />}

      {!hasTrack && (
        <div className="relative overflow-hidden border-b border-line">
          <div aria-hidden className="dot-grid absolute inset-0 opacity-50" />
          <div className="relative flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-line-strong bg-panel text-muted">
              <HeadphonesIcon size={20} />
            </span>
            <p className="text-sm font-medium text-ink">Nothing playing yet</p>
            <p className="max-w-xs text-[13px] text-muted">Paste a YouTube link above. Everyone in the room hears it on their own device, in lockstep.</p>
          </div>
        </div>
      )}

      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="label">{hasTrack ? (playing ? 'Now playing' : 'Paused') : 'Deck idle'}</p>
            <h2 className="mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-ink sm:text-2xl" title={room?.title ?? undefined}>
              {hasTrack ? room?.title || 'Loading title…' : '—'}
            </h2>
            {hasTrack && <p className="mt-1 font-mono text-[11px] text-faint">youtube · {room?.videoId}</p>}
          </div>
          <div className="mt-5 flex items-center gap-2">
            {room?.videoId && <AddToPlaylist videoId={room.videoId} title={room.title ?? ''} notify={props.notify} variant="deck" />}
            <FavoriteButton videoId={room?.videoId ?? null} title={room?.title ?? ''} />
          </div>
        </div>

        {error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</p>}

        <Scrubber
          duration={duration}
          disabled={!canControl || duration <= 0}
          getPosition={props.getPosition}
          getLoadedFraction={props.getLoadedFraction}
          onSeek={props.onSeek}
          stateSeq={room?.seq ?? 0}
        />

        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <button type="button" onClick={props.onResync} className="btn h-9 justify-self-start px-3 text-xs" disabled={!hasTrack} title="Re-measure the clock and snap to the room">
            <ResyncIcon size={15} />
            Resync
          </button>

          <button
            type="button"
            onClick={props.onTogglePlay}
            disabled={!canControl}
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            className="flex size-14 items-center justify-center rounded-full bg-ink text-canvas ring-4 ring-sunken transition hover:scale-[1.03] active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          >
            {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} className="translate-x-px" />}
          </button>

          <button
            type="button"
            onClick={props.onVoteSkip}
            aria-pressed={props.skip.mine}
            className={`btn h-9 justify-self-end px-3 text-xs ${props.skip.mine ? 'border-ink bg-ink text-canvas hover:bg-ink-2' : ''}`}
            disabled={!canControl}
            title={
              props.skip.needed === 1
                ? 'Skip this track'
                : props.skip.mine
                  ? 'You voted to skip. Click to take it back.'
                  : `Vote to skip: skips when ${props.skip.needed} of you agree`
            }
          >
            {props.skip.needed === 1 ? 'Skip' : `Skip ${props.skip.votes}/${props.skip.needed}`}
            <NextIcon size={14} />
          </button>
        </div>

        <ReactionBar onReact={props.onReact} disabled={!connected} />
      </div>
    </section>
  );
}
