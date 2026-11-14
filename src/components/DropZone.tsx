import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { parseYouTubeId } from '../shared/youtube';
import { PlayIcon, PlusIcon } from './icons';

/** Links dragged from YouTube arrive as a uri-list, plain text, or an <a> inside HTML. */
export function linkFromDrop(dt: DataTransfer): string | null {
  const candidates = [
    ...dt.getData('text/uri-list').split(/\r?\n/).filter((l) => l && !l.startsWith('#')),
    dt.getData('text/plain'),
    ...(dt.getData('text/html').match(/href="([^"]+)"/g) ?? []).map((m) => m.slice(6, -1)),
  ];
  return candidates.map((c) => c.trim()).find((c) => parseYouTubeId(c)) ?? null;
}

const carriesText = (dt: DataTransfer | null) => !!dt && [...dt.types].some((t) => t === 'text/uri-list' || t === 'text/plain' || t === 'text/html');

interface Props {
  enabled: boolean;
  onPlayNow: (url: string) => void;
  onQueue: (url: string) => void;
  onReject: (message: string) => void;
}

/** Full-page drop target: drag a YouTube link from another tab and drop it on Play now or Queue. */
export function DropZone({ enabled, onPlayNow, onQueue, onReject }: Props) {
  const [active, setActive] = useState(false);
  const [over, setOver] = useState<'play' | 'queue' | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const enter = (e: DragEvent) => {
      if (!carriesText(e.dataTransfer)) return;
      depth.current++;
      setActive(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setActive(false);
        setOver(null);
      }
    };
    const overWindow = (e: DragEvent) => {
      if (carriesText(e.dataTransfer)) e.preventDefault(); // allow dropping
    };
    const end = () => {
      depth.current = 0;
      setActive(false);
      setOver(null);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overWindow);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overWindow);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, [enabled]);

  if (!active) return null;

  const drop = (mode: 'play' | 'queue') => (e: ReactDragEvent) => {
    e.preventDefault();
    const url = linkFromDrop(e.dataTransfer);
    if (!url) return onReject('That drop wasn’t a YouTube link.');
    (mode === 'play' ? onPlayNow : onQueue)(url);
  };

  const zone = (mode: 'play' | 'queue', label: string, hint: string, Icon: typeof PlayIcon) => (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(mode);
      }}
      onDragLeave={() => setOver((o) => (o === mode ? null : o))}
      onDrop={drop(mode)}
      data-dropzone={mode}
      className={`flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        over === mode ? 'border-brand bg-brand-soft text-ink' : 'border-line-strong bg-panel/70 text-ink-2'
      }`}
    >
      <span className={`flex size-14 items-center justify-center rounded-full ${over === mode ? 'bg-brand text-on-brand' : 'bg-sunken text-ink'}`}>
        <Icon size={22} />
      </span>
      <span className="text-lg font-semibold tracking-tight">{label}</span>
      <span className="font-mono text-[11px] text-muted">{hint}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col gap-4 bg-canvas/80 p-6 backdrop-blur-md sm:flex-row sm:p-10" aria-label="Drop a YouTube link">
      {zone('play', 'Drop to play now', 'replaces what’s playing, for everyone', PlayIcon)}
      {zone('queue', 'Drop to queue', 'adds it to up next', PlusIcon)}
    </div>
  );
}
