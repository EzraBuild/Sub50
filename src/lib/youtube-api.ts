/** YouTube player states (mirrors YT.PlayerState without needing the API loaded). */
export const YTState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<typeof YT> | null = null;

/** Loads https://www.youtube.com/iframe_api once and resolves with the global `YT`. */
export function loadYouTubeApi(): Promise<typeof YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;

  pending = new Promise<typeof YT>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      pending = null;
      script.remove();
      reject(new Error('Could not load the YouTube IFrame API.'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube rejected that video id.';
    case 5:
      return 'This video cannot play in an HTML5 player.';
    case 100:
      return 'Video not found — it may be private or removed.';
    case 101:
    case 150:
    case 153:
      return 'The owner does not allow this video to be embedded. Try another upload.';
    default:
      return `YouTube player error ${code}.`;
  }
}
