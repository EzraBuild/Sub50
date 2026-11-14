import { useEffect, useRef } from 'react';
import type { RoomState } from '../shared/protocol';

interface Handlers {
  play: () => void;
  pause: () => void;
  next: () => void;
}

/**
 * Lock-screen / notification metadata and controls, plus a live tab title.
 *
 * Caveat: the audio itself plays inside YouTube's cross-origin iframe. Browsers
 * that route system media controls to the frame that's making sound will show
 * YouTube's own session instead, and these handlers never fire there. Where the
 * browser does route them to the top page, play / pause / skip act on the whole
 * room instead of only this device.
 *
 * We deliberately don't play a silent <audio> in the page to steal the session:
 * on iOS a second playing media element can pause the YouTube audio.
 */
export function useMediaSession(state: RoomState | null, roomId: string, listeners: number, handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  const title = state?.videoId ? state.title || 'Loading title…' : null;
  const playing = !!state?.isPlaying;
  const videoId = state?.videoId ?? null;

  // Tab title: useful on desktop too, and works everywhere.
  useEffect(() => {
    document.title = title ? `${playing ? '▶' : '❚❚'} ${title} — Sub50` : 'Sub50';
  }, [title, playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = videoId
      ? new MediaMetadata({
          title: title ?? '',
          artist: `Sub50 · room ${roomId}`,
          album: `${listeners} listening`,
          artwork: [
            { src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
            { src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
          ],
        })
      : null;
    ms.playbackState = videoId ? (playing ? 'playing' : 'paused') : 'none';
  }, [videoId, title, playing, roomId, listeners]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported by this browser */
      }
    };
    set('play', () => ref.current.play());
    set('pause', () => ref.current.pause());
    set('nexttrack', () => ref.current.next());
    return () => {
      set('play', null);
      set('pause', null);
      set('nexttrack', null);
    };
  }, []);
}
