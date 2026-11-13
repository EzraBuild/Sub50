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
    <div className="relative flex items-center" ref={popRef}>
      <button type="button" onClick={copy} className="btn rounded-r-none border-r-0 px-3" title={url}>
        {copied ? <CheckIcon className="text-emerald-400" /> : <LinkIcon />}
        <span className="hidden md:inline">{copied ? 'Copied' : 'Copy LAN Link'}</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="icon-btn rounded-l-none"
        aria-label="Show QR code"
        aria-expanded={open}
      >
        <QrIcon />
      </button>

      {open && (
        <div className="card absolute top-12 right-0 z-30 w-64 p-4 shadow-2xl shadow-black/60">
          <p className="label mb-3">Scan to join</p>
          {svg ? (
            <div className="overflow-hidden rounded-lg [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="aspect-square rounded-lg bg-zinc-800" />
          )}
          <p className="mt-3 font-mono text-[11px] break-all text-zinc-400 select-all">{url}</p>
        </div>
      )}
    </div>
  );
}
