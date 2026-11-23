import type { SearchResult } from '../server/search';
import { accessPass } from './accessPass';

let enabled = false;

/** The page tells the client whether search is set up (a YouTube key) for this visitor. */
export const setSearchEnabled = (on: boolean) => {
  enabled = on;
};

export const searchEnabled = () => enabled;

/** Songs by name from /api/search. Carries the invite-only pass; errors carry a message to show. */
export async function searchSongs(q: string): Promise<SearchResult[]> {
  const pass = accessPass();
  let r: Response;
  try {
    r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, pass ? { headers: { 'x-sub50-pass': pass } } : undefined);
  } catch {
    throw new Error('Couldn’t reach search. Check your connection.');
  }
  const body = (await r.json().catch(() => ({}))) as { results?: SearchResult[]; error?: string };
  if (!r.ok || !body.results) throw new Error(body.error ?? 'Search failed.');
  return body.results;
}
