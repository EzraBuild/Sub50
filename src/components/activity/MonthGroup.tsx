import { useState, type ReactNode } from 'react';
import { ChevronIcon } from '../icons';

/** "November", or "November 2025" outside this year. */
export function monthTitle(at: number, now = Date.now()): string {
  const d = new Date(at);
  return d.toLocaleDateString([], { month: 'long', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** A month in a long list: a header you fold with ▸ / ▾, its rows under it. */
export function MonthGroup({ at, meta, defaultOpen, children }: { at: number; meta: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const title = monthTitle(at);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 bg-sunken/60 px-4 py-2.5 text-left transition-colors hover:bg-sunken sm:px-6 ${open ? 'border-b border-line' : ''}`}
      >
        <ChevronIcon size={13} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="label text-ink-2">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">{meta}</span>
      </button>
      {open && <ol className="divide-y divide-line">{children}</ol>}
    </li>
  );
}
