/**
 * The invite-only pass the room page handed this tab (null when Sub50 is open).
 * The sync socket sends it as ?pass= and search as a header; the server checks it.
 */
let pass: string | null = null;

export const setAccessPass = (p: string | null) => {
  pass = p;
};

export const accessPass = () => pass;

/** The socket URL with the pass on it, when there is one. */
export const withPass = (url: string) => (pass ? `${url}${url.includes('?') ? '&' : '?'}pass=${encodeURIComponent(pass)}` : url);
