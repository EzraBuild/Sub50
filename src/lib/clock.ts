/**
 * NTP-lite clock sync.
 *
 * Each PING/PONG round trip gives one estimate:
 *   rtt         = receivedAt - clientTime
 *   clockOffset = serverTime - (clientTime + rtt / 2)
 *
 * The estimate assumes the trip was symmetric, so slow samples (a busy main
 * thread, a Wi-Fi power-save wakeup) can be badly skewed. We keep a sliding
 * window and trust the fastest few round trips, which are the most symmetric.
 */

interface Sample {
  rtt: number;
  offset: number;
}

const WINDOW = 16;
const BEST = 3;

/** High-resolution, monotonic client clock in epoch ms. */
export const clientNow = (): number => performance.timeOrigin + performance.now();

export class ClockSync {
  private samples: Sample[] = [];
  private _offset = 0;
  private _rtt: number | null = null;

  /** Server time (ms) right now, as best we can tell. */
  serverNow(): number {
    return clientNow() + this._offset;
  }

  get offset(): number {
    return this._offset;
  }

  /** Median of the recent round trips, i.e. what a user would call "ping". */
  get rtt(): number | null {
    return this._rtt;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  addSample(clientTime: number, serverTime: number, receivedAt = clientNow()): void {
    const rtt = receivedAt - clientTime;
    if (!(rtt >= 0) || rtt > 10_000) return;
    this.samples.push({ rtt, offset: serverTime - (clientTime + rtt / 2) });
    if (this.samples.length > WINDOW) this.samples.shift();

    const fastest = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
    this._offset = fastest.reduce((sum, s) => sum + s.offset, 0) / fastest.length;

    const recent = this.samples.slice(-5).map((s) => s.rtt).sort((a, b) => a - b);
    this._rtt = recent[Math.floor(recent.length / 2)] ?? null;
  }

  /** Forget everything, e.g. after a reconnect or when the tab wakes from sleep. */
  reset(): void {
    this.samples = [];
    this._rtt = null;
  }
}
