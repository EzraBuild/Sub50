'use client';

import { useEffect, useRef } from 'react';
import { Meter } from '../lib/beat';

/** Target level (0..1) per column right now, or null when nothing is sounding. */
export type LevelSource = (cols: number) => number[] | null;

interface Props {
  source: LevelSource;
  label: string;
  /** Right-hand tag, e.g. SYNC or MIC. */
  mode: string;
  /** Status dot: live (playing), rec (capturing from the mic), idle. */
  status: 'live' | 'rec' | 'idle';
}

/** Cell size grows on wide screens so there are ~56 distinct columns, never a wall of dots. */
const TARGET_COLS = 56;
const MIN_PITCH = 7;
const MAX_PITCH = 12;

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  return { lit: css.getPropertyValue('--ink').trim() || '#e8eeea', dim: css.getPropertyValue('--line-strong').trim() || '#2a3430' };
}

const STATUS_DOT = { live: 'bg-lock', rec: 'bg-bad animate-pulse', idle: 'bg-faint' } as const;

/** Minimal dot-matrix meter: lit columns over a dim grid, with a peak dot that hangs and falls. */
export function DotMatrix({ source, label, mode, status }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const meter = new Meter();
    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let pitch = MIN_PITCH;
    let dot = 4;
    let colors = themeColors();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, width / TARGET_COLS));
      dot = Math.round(pitch * 0.58);
      const gap = pitch - dot;
      cols = Math.max(1, Math.floor((width + gap) / pitch));
      rows = Math.max(1, Math.floor((height + gap) / pitch));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Follow theme switches (data-theme) and OS light/dark changes.
    const recolor = () => (colors = themeColors());
    const mo = new MutationObserver(recolor);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', recolor);

    // 30fps is plenty for a meter; reduced motion drops to a gentle ~6fps.
    const frameMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 160 : 33;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      if (dt < frameMs) return;
      last = now;
      const targets = sourceRef.current(cols) ?? new Array<number>(cols).fill(0);
      meter.step(targets, dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gap = pitch - dot;
      const size = Math.max(1, Math.round(dot * dpr));
      const x0 = (width - (cols * pitch - gap)) / 2;
      const y0 = height - (height - (rows * pitch - gap)) / 2; // bottom edge of the grid
      const at = (c: number, r: number): [number, number] => [Math.round((x0 + c * pitch) * dpr), Math.round((y0 - (r + 1) * pitch + gap) * dpr)];

      const lit = meter.levels.map((v) => Math.round(v * rows));
      const peak = meter.peaks.map((v) => Math.round(v * rows) - 1);

      ctx.fillStyle = colors.dim;
      for (let c = 0; c < cols; c++) {
        for (let r = lit[c] ?? 0; r < rows; r++) {
          if (r === peak[c] && r >= (lit[c] ?? 0)) continue;
          const [x, y] = at(c, r);
          ctx.fillRect(x, y, size, size);
        }
      }
      ctx.fillStyle = colors.lit;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < (lit[c] ?? 0); r++) {
          const [x, y] = at(c, r);
          ctx.fillRect(x, y, size, size);
        }
        const p = peak[c] ?? -1;
        if (p >= (lit[c] ?? 0) && p < rows) {
          const [x, y] = at(c, p);
          ctx.fillRect(x, y, size, size);
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      scheme.removeEventListener('change', recolor);
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <canvas ref={canvasRef} aria-hidden className="min-h-0 w-full flex-1" />
      <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.04em]">
        <span className="flex items-center gap-2 text-muted">
          <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {label}
        </span>
        <span className="text-ink-2 uppercase">{mode}</span>
      </div>
    </div>
  );
}
