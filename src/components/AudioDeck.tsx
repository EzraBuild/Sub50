import type { RefObject } from 'react';
import type { RoomState } from '../shared/protocol';
import { HeadphonesIcon, NextIcon, PauseIcon, PlayIcon, ResyncIcon, VideoIcon, VideoOffIcon } from './icons';
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
  onNext: () => void;
}

export function AudioDeck(props: Props) {
  const { hostRef, room, duration, error, showVideo, connected } = props;
  const hasTrack = !!room?.videoId;
  const playing = !!room?.isPlaying;
  const canControl = hasTrack && connected;

  return (
    <section className="card overflow-hidden" aria-label="Audio deck">
      {/* The iframe stays mounted when hidden (1px, transparent) so audio keeps playing,
          and YouTube drops to its lowest video quality, which saves battery and data. */}
      <div
        className={`relative w-full bg-black transition-[opacity] duration-300 ${
          showVideo && hasTrack ? 'aspect-video opacity-100' : 'pointer-events-none h-px opacity-0'
        }`}
      >
        <div ref={hostRef} className="yt-host absolute inset-0" />
      </div>

      {!hasTrack && (
        <div className="flex flex-col items-center justify-center gap-3 border-b border-line px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full border border-line text-muted">
            <HeadphonesIcon size={22} />
          </span>
          <p className="text-sm text-ink-2">Nothing playing yet</p>
          <p className="max-w-xs text-xs text-muted">Paste a YouTube link above. Everyone in the room hears it in lockstep on their own device.</p>
        </div>
      )}

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label mb-1">{hasTrack ? (playing ? 'Now playing' : 'Paused') : 'Deck idle'}</p>
            <h2 className="truncate text-[15px] font-medium text-ink" title={room?.title ?? undefined}>
              {hasTrack ? room?.title || 'Loading title…' : '—'}
            </h2>
            {hasTrack && <p className="mt-0.5 font-mono text-[11px] text-faint">{room?.videoId}</p>}
          </div>
          <button
            type="button"
            onClick={props.onToggleVideo}
            className="btn h-8 shrink-0 px-2.5 text-xs"
            disabled={!hasTrack}
            aria-pressed={showVideo}
            title={showVideo ? 'Hide video to save battery' : 'Show video'}
          >
            {showVideo ? <VideoOffIcon size={15} /> : <VideoIcon size={15} />}
            {showVideo ? 'Hide video' : 'Show video'}
          </button>
        </div>

        {error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

        <Scrubber
          duration={duration}
          disabled={!canControl || duration <= 0}
          getPosition={props.getPosition}
          getLoadedFraction={props.getLoadedFraction}
          onSeek={props.onSeek}
          stateSeq={room?.seq ?? 0}
        />

        <div className="flex items-center justify-between">
          <button type="button" onClick={props.onResync} className="btn h-9 px-3 text-xs" disabled={!hasTrack} title="Re-measure the clock and snap to the room">
            <ResyncIcon size={15} />
            Resync
          </button>

          <button
            type="button"
            onClick={props.onTogglePlay}
            disabled={!canControl}
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            className="flex size-14 items-center justify-center rounded-full bg-ink text-canvas shadow-lg shadow-shade transition hover:bg-ink-2 active:scale-95 disabled:opacity-40"
          >
            {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} className="translate-x-px" />}
          </button>

          <button
            type="button"
            onClick={props.onNext}
            className="btn h-9 px-3 text-xs"
            disabled={!connected || !room?.queue.length}
            title="Skip to the next track in the queue"
          >
            Next
            <NextIcon size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
