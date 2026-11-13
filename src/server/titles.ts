import { LIMITS } from '../shared/protocol';

const cache = new Map<string, Promise<string | null>>();

/**
 * Resolves a video title through YouTube's public oEmbed endpoint.
 * Results (including failures) are cached for the life of the process.
 */
export function resolveTitle(videoId: string): Promise<string | null> {
  let pending = cache.get(videoId);
  if (!pending) {
    pending = fetchTitle(videoId);
    cache.set(videoId, pending);
    // Allow a retry later if the lookup failed (e.g. a transient network blip).
    void pending.then((title) => {
      if (title === null) setTimeout(() => cache.delete(videoId), 60_000).unref();
    });
  }
  return pending;
}

async function fetchTitle(videoId: string): Promise<string | null> {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${target}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown };
    return typeof body.title === 'string' ? body.title.slice(0, LIMITS.TITLE_MAX) : null;
  } catch {
    return null;
  }
}
