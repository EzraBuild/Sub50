import type { ReactNode } from 'react';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const POS: Record<Corner, string> = {
  tl: '-top-[5px] -left-[5px]',
  tr: '-top-[5px] -right-[5px]',
  bl: '-bottom-[5px] -left-[5px]',
  br: '-bottom-[5px] -right-[5px]',
};

/** A small "+" where two hairlines cross. Purely decorative. */
export function Cross({ at, className = '' }: { at: Corner; className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-10 size-[9px] ${POS[at]} ${className}`}>
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-faint" />
      <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-faint" />
    </span>
  );
}

/** Numbered section header: `01 / Deck` on the left, optional meta on the right. */
export function SectionHead({ index, title, meta }: { index: string; title: string; meta?: ReactNode }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
      <p className="label">
        <span className="text-faint">{index} /</span> <span className="text-ink-2">{title}</span>
      </p>
      {meta && <div className="font-mono text-[11px] text-muted">{meta}</div>}
    </div>
  );
}
