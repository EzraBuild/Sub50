import { useState, type FormEvent } from 'react';
import { LIMITS } from '../shared/protocol';
import { Cross } from './Frame';
import { HeadphonesIcon, LogoMark } from './icons';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  roomId: string;
  name: string;
  connected: boolean;
  /** Called synchronously from the tap so the browser treats playback as user-initiated. */
  onEnter: (name: string) => void;
}

/**
 * Full-screen audio-unlock gate. Mobile browsers only allow unmuted playback
 * that starts inside a real user gesture, so nothing plays until this is tapped.
 */
export function Gate({ roomId, name, connected, onEnter }: Props) {
  const [draft, setDraft] = useState(name);

  const enter = (e?: FormEvent) => {
    e?.preventDefault();
    onEnter(draft.trim().slice(0, LIMITS.NAME_MAX) || name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas px-4 py-10">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_55%_at_50%_45%,#000,transparent)]" />
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>

      <form onSubmit={enter} className="rise relative w-full max-w-[400px] border border-line bg-panel">
        <Cross at="tl" />
        <Cross at="tr" />
        <Cross at="bl" />
        <Cross at="br" />

        <div className="flex h-11 items-center justify-between border-b border-line px-4">
          <span className="flex items-center gap-2">
            <LogoMark size={18} />
            <span className="text-[14px] font-semibold tracking-tight text-ink">
              Sub<span className="text-lock">50</span>
            </span>
          </span>
          <span className="chip">room {roomId}</span>
        </div>

        <div className="px-5 pt-8 pb-6 sm:px-7">
          <button type="submit" className="group relative mx-auto mb-7 flex size-24 items-center justify-center rounded-full" aria-label="Tap to Enter Sub50">
            <span className="ring-out absolute inset-0 rounded-full border border-brand/40" />
            <span className="ring-out absolute inset-0 rounded-full border border-brand/25 [animation-delay:1.3s]" />
            <span className="absolute inset-2 rounded-full border border-line bg-sunken transition group-hover:border-line-strong group-active:scale-95" />
            <LogoMark size={40} className="relative" />
          </button>

          <h1 className="text-center text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink">
            Tap to Enter Sub<span className="text-lock">50</span>
          </h1>
          <p className="mt-2 text-center text-[13px] text-muted">One tap unlocks audio on this device, then you&apos;re on the room&apos;s clock.</p>

          <label className="mt-7 block">
            <span className="label">
              <span className="text-faint">01 /</span> your name
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={LIMITS.NAME_MAX}
              autoComplete="nickname"
              className="mt-2 h-11 w-full rounded-lg border border-line-strong bg-canvas px-3.5 text-sm text-ink transition-colors focus:border-ink/40 focus:outline-none"
            />
          </label>

          <p className="label mt-5">
            <span className="text-faint">02 /</span> unlock
          </p>
          <button type="submit" className="btn-primary mt-2 h-12 w-full text-[14px]">
            Enter &amp; unlock audio
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <HeadphonesIcon size={12} />
            headphones recommended
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${connected ? 'bg-lock' : 'animate-pulse bg-warn'}`} />
            {connected ? 'connected' : 'connecting'}
          </span>
        </div>
      </form>
    </div>
  );
}

/** Shown when the browser refuses a programmatic play (autoplay policy). Any tap fixes it. */
export function BlockedOverlay({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-canvas/85 px-8 text-center backdrop-blur-sm"
    >
      <span className="flex size-16 items-center justify-center rounded-full border border-warn/40 bg-warn/10 text-warn">
        <HeadphonesIcon size={26} />
      </span>
      <span className="text-lg font-semibold tracking-tight text-ink">Tap to resume audio</span>
      <span className="max-w-xs text-sm text-muted">Your browser paused playback. One tap and you&apos;re back on the room timeline.</span>
    </button>
  );
}

export function ToastView({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="rise rounded-lg border border-line bg-panel px-4 py-2.5 text-sm text-ink shadow-2xl shadow-shade" role="alert">
        {message}
      </div>
    </div>
  );
}
