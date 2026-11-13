const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Matches every common YouTube URL shape and captures the 11-char video id:
 *   youtube.com/watch?v=ID (any param order), m./www./music.youtube.com,
 *   youtu.be/ID, youtube.com/shorts/ID, /embed/ID, /live/ID, /v/ID,
 *   youtube-nocookie.com/embed/ID
 */
const YOUTUBE_URL =
  /(?:^|\/\/|\.)(?:youtube(?:-nocookie)?\.com\/(?:watch\/?\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/|v\/|e\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i;

/** Extracts a YouTube video id from a URL (or a bare id). Returns null if none. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return text;
  const match = YOUTUBE_URL.exec(text);
  return match?.[1] ?? null;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
