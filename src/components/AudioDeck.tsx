import type { RefObject } from 'react';
import type { Reaction, RoomState } from '../shared/protocol';
import { thumbnailUrl } from '../shared/youtube';
import { FavoriteButton } from './FavoriteButton';
import { SectionHead } from './Frame';
import { HeadphonesIcon, NextIcon, PauseIcon, PlayIcon, ResyncIcon, VideoIcon, VideoOffIcon } from './icons';
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
}

/** Bar heights for the audio-only equalizer (fixed, so it never jumps between renders). */
const BARS = [0.35, 0.6, 0.45, 0.8, 0.55, 0.95, 0.5, 0.7, 0.4, 0.85, 0.6, 0.3, 0.75, 0.5, 0.9, 0.45, 0.65, 0.35, 0.8, 0.55, 0.7, 0.4, 0.6, 0.3];

function AudioOnlyArt({ videoId, playing }: { videoId: string; playing: boolean }) {
  return (
    <div className={`relative flex h-44 items-end justify-center overflow-hidden border-b border-line sm:h-52 ${playing ? '' : 'eq-paused'}`}>
      {/* The track's own thumbnail as a soft wash of color behind the bars. */}
      <img src={thumbnailUrl(videoId)} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-[0.14] blur-2xl" />
      <div aria-hidden className="dot-grid absolute inset-0 opacity-60" />
      <div className="relative flex h-28 items-end gap-[5px] pb-8 sm:h-32">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={`eq-bar w-[5px] rounded-full ${playing ? 'bg-brand' : 'bg-line-strong'}`}
            style={{ height: `${h * 100}%`, animationDelay: `${(i * 97) % 900}ms`, animationDuration: `${900 + ((i * 53) % 500)}ms` }}
          />
        ))}
      </div>
      <span className="label absolute top-3 left-4">audio only</span>
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

      {hasTrack && !showVideo && <AudioOnlyArt videoId={room!.videoId!} playing={playing} />}

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
          <div className="mt-5">
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
