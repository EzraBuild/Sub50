import { useCallback, useEffect, useRef, useState } from 'react';
import { isAppleMobile, spectrumToColumns } from '../lib/spectrum';

/** blocked = permission denied; missing = no usable microphone (none, busy, unsupported). */
export type MicState = 'off' | 'starting' | 'on' | 'blocked' | 'missing';

interface Capture {
  stream: MediaStream;
  ctx: AudioContext;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
}

/**
 * Opt-in "react to sound": listens through the microphone (to the music coming
 * out of the speakers) and turns it into visualizer columns. Never starts on its
 * own, and lets go of the mic when stopped or unmounted.
 *
 * Not offered on iPhone/iPad: opening the mic there switches the audio session
 * and moves playback to the quiet earpiece.
 */
export function useMicLevels() {
  const available =
    typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && 'AudioContext' in window && !isAppleMobile();
  const [state, setState] = useState<MicState>('off');
  const capture = useRef<Capture | null>(null);

  const stop = useCallback(() => {
    const c = capture.current;
    capture.current = null;
    if (c) {
      for (const track of c.stream.getTracks()) track.stop();
      void c.ctx.close();
    }
    setState((s) => (s === 'blocked' || s === 'missing' ? s : 'off'));
  }, []);

  const start = useCallback(async () => {
    if (!available || capture.current) return;
    setState('starting');
    try {
      // Raw signal: echo cancellation and noise suppression would scrub out the very music we want to see.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -25;
      // Analysed only; never routed to the speakers (no feedback loop).
      ctx.createMediaStreamSource(stream).connect(analyser);
      capture.current = { stream, ctx, analyser, bins: new Uint8Array(analyser.frequencyBinCount) };
      setState('on');
    } catch (err) {
      const name = (err as DOMException)?.name;
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'missing');
    }
  }, [available]);

  useEffect(() => stop, [stop]);

  /** Current columns from the mic, or null when it's off. */
  const read = useCallback((cols: number): number[] | null => {
    const c = capture.current;
    if (!c) return null;
    c.analyser.getByteFrequencyData(c.bins);
    return spectrumToColumns(c.bins, c.ctx.sampleRate, cols);
  }, []);

  return { available, state, start, stop, read };
}
