import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { copyText } from '../lib/identity';
import { CheckIcon, LinkIcon, QrIcon } from './icons';

/** "Copy LAN Link" plus a QR popover, which is the fastest way to get a phone into the room. */
export function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#09090b', light: '#fafafa' } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      setOpen(true); // can't copy here, so show the link and QR instead
    }
  };

  return (
    <div className="relative flex items-center gap-0.5" ref={popRef}>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-sunken"
        title={url}
      >
        {copied ? <CheckIcon size={16} className="text-lock" /> : <LinkIcon size={16} />}
        <span className="hidden md:inline">{copied ? 'Copied' : 'Copy link'}</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        aria-label="Show QR code"
        aria-expanded={open}
      >
        <QrIcon size={16} />
      </button>

      {open && (
        <div className="rise absolute top-[calc(100%+12px)] right-0 z-40 w-64 rounded-xl border border-line bg-panel p-4 shadow-2xl shadow-shade">
          <p className="label mb-3">
            <span className="text-faint">→</span> Scan to join
          </p>
          {svg ? (
            <div className="overflow-hidden rounded-lg [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="aspect-square rounded-lg bg-sunken" />
          )}
          <p className="mt-3 font-mono text-[11px] break-all text-muted select-all">{url}</p>
        </div>
      )}
    </div>
  );
}
