import { useState, type FormEvent } from 'react';
import { LIMITS } from '../shared/protocol';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/95 px-6 backdrop-blur-xl">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form onSubmit={enter} className="flex w-full max-w-sm flex-col items-center text-center">
        <button type="submit" className="group relative mb-10 flex size-36 items-center justify-center rounded-full" aria-label="Tap to Enter Sub50">
          <span className="ring-out absolute inset-0 rounded-full border border-brand/40" />
          <span className="ring-out absolute inset-0 rounded-full border border-brand/25 [animation-delay:1.3s]" />
          <span className="absolute inset-3 rounded-full border border-line bg-panel transition group-hover:border-line-strong group-active:scale-95" />
          <LogoMark size={56} className="relative" />
        </button>

        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Tap to Enter Sub<span className="text-lock">50</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          Joining room <span className="font-mono text-ink-2">{roomId}</span>
        </p>

        <label className="mt-8 w-full text-left">
          <span className="label">Your name</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={LIMITS.NAME_MAX}
            autoComplete="nickname"
            className="mt-1.5 h-11 w-full rounded-lg border border-line bg-sunken px-3.5 text-sm text-ink focus:border-line-strong focus:outline-none"
          />
        </label>

        <button type="submit" className="btn-primary mt-4 h-12 w-full text-[15px]">
          Enter &amp; unlock audio
        </button>

        <p className="mt-6 flex items-center gap-2 text-xs text-faint">
          <HeadphonesIcon size={14} />
          Headphones recommended · {connected ? 'server connected' : 'connecting…'}
        </p>
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
      <span className="text-lg font-medium text-ink">Tap to resume audio</span>
      <span className="max-w-xs text-sm text-muted">Your browser paused playback. One tap and we&apos;ll drop you back onto the room timeline.</span>
    </button>
  );
}

export function ToastView({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="card px-4 py-2.5 text-sm text-ink shadow-2xl shadow-shade" role="alert">
        {message}
      </div>
    </div>
  );
}
