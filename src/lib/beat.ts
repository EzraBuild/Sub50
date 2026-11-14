/**
 * A synced "groove" for the audio-only visualizer.
 *
 * Browsers don't let the page read YouTube's audio, so this doesn't analyse the
 * music. It's a deterministic pattern from (track, playback position): every
 * device in the room shows the same thing, it stops on pause and follows seeks.
 * Kick on every beat in the lows, snare on 2 and 4 in the mids, hats on the
 * eighths up top, over a slowly drifting spectrum.
 */

/** FNV-1a, so the same track gets the same groove everywhere. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable pseudo-random in [0, 1) for a pair of integers. */
function noise(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface Groove {
  seed: number;
  bpm: number;
  cols: { w1: number; w2: number; p1: number; p2: number }[];
}

export const BPM_RANGE = [88, 132] as const;

export function groove(track: string, cols: number): Groove {
  const seed = hash(track);
  const bpm = BPM_RANGE[0] + Math.round(noise(seed, 1) * (BPM_RANGE[1] - BPM_RANGE[0]));
  return {
    seed,
    bpm,
    cols: Array.from({ length: cols }, (_, c) => ({
      w1: 1.2 + noise(seed, 100 + c) * 3,
      w2: 0.4 + noise(seed, 200 + c) * 1.6,
      p1: noise(seed, 300 + c) * Math.PI * 2,
      p2: noise(seed, 400 + c) * Math.PI * 2,
    })),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Target level (0..1) for each column at playback position `t` seconds. */
export function grooveLevels(g: Groove, t: number): number[] {
  const beats = (t * g.bpm) / 60;
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const eighth = (beats * 2) % 1;
  const kick = Math.exp(-phase * 7);
  const snare = beat % 2 === 1 ? Math.exp(-phase * 9) : 0;
  const hat = Math.exp(-eighth * 12);
  // Each bar gets its own energy, like sections of a song.
  const bar = 0.72 + noise(g.seed, 1000 + Math.floor(beat / 4)) * 0.28;
  // Each beat reshapes the spectrum: a few "mountains" at seeded spots.
  const bumps = [0, 1, 2].map((k) => ({
    at: noise(g.seed + k, beat * 3 + k),
    width: 0.006 + noise(g.seed + 10 + k, beat) * 0.03,
    height: 0.3 + noise(g.seed + 20 + k, beat) * 0.5,
  }));
  const pump = 0.45 + 0.55 * kick; // the whole meter breathes with the kick
  const n = g.cols.length;
  return g.cols.map((col, c) => {
    const x = n > 1 ? c / (n - 1) : 0;
    const drift = 0.5 + 0.5 * Math.sin(t * col.w1 + col.p1) * Math.cos(t * col.w2 + col.p2);
    let shape = 0;
    for (const b of bumps) shape += b.height * Math.exp(-((x - b.at) ** 2) / b.width);
    // Neighbours differ a little, and no two beats look the same.
    const jag = noise(beat * 7 + 3, c + g.seed) * 0.16;
    const level =
      0.04 +
      Math.min(shape, 0.75) * pump +
      kick * Math.exp(-x * 6) * 0.45 +
      snare * Math.exp(-((x - 0.45) ** 2) / 0.02) * 0.3 +
      hat * x ** 1.4 * 0.28 +
      drift * 0.08 +
      jag;
    return clamp01(level * bar);
  });
}

/**
 * Meter ballistics: fast attack, slower fall, and a peak dot that holds briefly
 * before dropping. Pure, so the renderer just draws `levels` and `peaks`.
 */
export class Meter {
  levels: number[] = [];
  peaks: number[] = [];
  private held: number[] = [];

  constructor(
    private readonly fallPerSec = 1.2,
    private readonly peakHoldMs = 600,
    private readonly peakFallPerSec = 0.5,
  ) {}

  step(targets: number[], dtMs: number): void {
    if (this.levels.length !== targets.length) {
      this.levels = targets.map(() => 0);
      this.peaks = targets.map(() => 0);
      this.held = targets.map(() => 0);
    }
    const dt = Math.min(dtMs, 100) / 1000;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      const cur = this.levels[i]!;
      this.levels[i] = target > cur ? cur + (target - cur) * 0.65 : Math.max(target, cur - this.fallPerSec * dt);
      if (this.levels[i]! >= this.peaks[i]!) {
        this.peaks[i] = this.levels[i]!;
        this.held[i] = this.peakHoldMs;
      } else if (this.held[i]! > 0) {
        this.held[i] = this.held[i]! - dt * 1000;
      } else {
        this.peaks[i] = Math.max(this.levels[i]!, this.peaks[i]! - this.peakFallPerSec * dt);
      }
    }
  }
}
