import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

interface Props {
  duration: number;
  disabled: boolean;
  /** Read every frame; must be cheap. */
  getPosition: () => number;
  getLoadedFraction: () => number;
  onSeek: (seconds: number) => void;
  /** Changes whenever the room state changes, which clears the optimistic seek. */
  stateSeq: number;
}

/**
 * Custom scrubber. Position is painted from requestAnimationFrame straight to
 * the DOM, so the bar moves smoothly without re-rendering React 60×/s.
 */
export function Scrubber({ duration, disabled, getPosition, getLoadedFraction, onSeek, stateSeq }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<number | null>(null);
  const pendingRef = useRef<{ t: number; until: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    pendingRef.current = null;
  }, [stateSeq]);

  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const pending = pendingRef.current && performance.now() < pendingRef.current.until ? pendingRef.current.t : null;
      const pos = dragRef.current ?? pending ?? getPosition();
      const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
      if (bufRef.current) bufRef.current.style.width = `${Math.min(100, getLoadedFraction() * 100)}%`;
      if (timeRef.current) {
        const text = formatTime(pos);
        if (timeRef.current.textContent !== text) {
          timeRef.current.textContent = text;
          trackRef.current?.setAttribute('aria-valuenow', String(Math.floor(pos)));
          trackRef.current?.setAttribute('aria-valuetext', `${text} of ${formatTime(duration)}`);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [duration, getPosition, getLoadedFraction]);

  const positionAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  const commit = (t: number) => {
    pendingRef.current = { t, until: performance.now() + 1500 };
    onSeek(t);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = positionAt(e.clientX);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null) dragRef.current = positionAt(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    const t = positionAt(e.clientX);
    dragRef.current = null;
    setDragging(false);
    commit(t);
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const pos = getPosition();
    const step = e.shiftKey ? 15 : 5;
    const next =
      e.key === 'ArrowRight' ? pos + step : e.key === 'ArrowLeft' ? pos - step : e.key === 'Home' ? 0 : e.key === 'End' ? duration - 1 : null;
    if (next === null) return;
    e.preventDefault();
    commit(Math.min(Math.max(0, next), Math.max(0, duration - 0.5)));
  };

  return (
    <div className="flex items-center gap-3 font-mono text-[11px] text-muted tabular-nums">
      <span ref={timeRef} className="w-11 text-right">
        0:00
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        className={`group relative flex h-6 flex-1 touch-none items-center ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-line">
          <div ref={bufRef} className="absolute inset-y-0 left-0 bg-line-strong" />
          <div ref={fillRef} className="absolute inset-y-0 left-0 bg-ink" />
        </div>
        <div
          ref={thumbRef}
          className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow transition-transform ${
            dragging ? 'scale-125' : 'scale-0 group-hover:scale-100 group-focus-visible:scale-100'
          }`}
        />
      </div>
      <span className="w-11">{formatTime(duration)}</span>
    </div>
  );
}
