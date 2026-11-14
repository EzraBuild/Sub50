/** Lowest and highest frequencies shown; music below/above this is mostly rumble or hiss. */
export const MIN_HZ = 40;
export const MAX_HZ = 12_000;

/**
 * Folds an AnalyserNode byte spectrum (linear bins, 0..255) into `cols`
 * log-spaced columns (0..1), the way ears hear pitch. Highs get a gentle lift
 * since music has far less energy up there.
 */
export function spectrumToColumns(bins: ArrayLike<number>, sampleRate: number, cols: number): number[] {
  const binHz = sampleRate / 2 / bins.length;
  const ratio = MAX_HZ / MIN_HZ;
  const out = new Array<number>(cols);
  for (let c = 0; c < cols; c++) {
    const lo = MIN_HZ * ratio ** (c / cols);
    const hi = MIN_HZ * ratio ** ((c + 1) / cols);
    const from = Math.min(bins.length - 1, Math.floor(lo / binHz));
    const to = Math.min(bins.length - 1, Math.max(from, Math.ceil(hi / binHz) - 1));
    let peak = 0;
    for (let b = from; b <= to; b++) peak = Math.max(peak, bins[b]!);
    const x = cols > 1 ? c / (cols - 1) : 0;
    out[c] = Math.min(1, (peak / 255) * (0.9 + 0.5 * x));
  }
  return out;
}

/** iPhone / iPad (including iPadOS that reports itself as a Mac). */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
