import { useEffect, useRef, useState } from 'react';
import type { ListeningSession, SessionChatMessage } from '../../server/accounts/history';
import { download, toCsv, toJson, youtubePlaylistUrl } from '../../lib/exportHistory';
import type { ChatLoader } from './RoomsTab';

/** Local date, YYYY-MM-DD. */
const stamp = () => new Date().toLocaleDateString('en-CA');

/** Export: CSV, JSON (with chat) or a YouTube playlist of your recent songs. */
export function ExportMenu({ sessions, loadChat, notify }: { sessions: ListeningSession[]; loadChat: ChatLoader; notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const csv = () => {
    setOpen(false);
    download(`sub50-listening-${stamp()}.csv`, toCsv(sessions), 'text/csv;charset=utf-8');
  };

  const json = async () => {
    setOpen(false);
    setBusy(true);
    try {
      // Chat is loaded per session; a few at a time keeps it quick without hammering the API.
      const chats: Record<string, SessionChatMessage[]> = {};
      for (let i = 0; i < sessions.length; i += 6) {
        await Promise.all(sessions.slice(i, i + 6).map(async (s) => (chats[s.id] = await loadChat(s.id).catch(() => []))));
      }
      download(`sub50-listening-${stamp()}.json`, toJson(sessions, chats), 'application/json');
    } finally {
      setBusy(false);
    }
  };

  const youtube = () => {
    setOpen(false);
    const url = youtubePlaylistUrl(sessions);
    if (!url) return notify('No songs to put in a playlist yet.');
    window.open(url, '_blank', 'noopener');
  };

  const item = 'block w-full px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-sunken';
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy || sessions.length === 0}
        aria-expanded={open}
        className="rounded-md px-2.5 py-1.5 font-mono text-[11.5px] tracking-[0.04em] text-muted uppercase transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
      >
        {busy ? 'exporting…' : 'export'}
      </button>
      {open && (
        <div role="menu" className="rise absolute top-full right-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-2xl shadow-shade">
          <button type="button" role="menuitem" onClick={csv} className={item}>
            Spreadsheet (CSV)
            <span className="block font-mono text-[10.5px] text-faint">every song, room, date, who with</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void json()} className={item}>
            Everything (JSON)
            <span className="block font-mono text-[10.5px] text-faint">sessions with their chat</span>
          </button>
          <button type="button" role="menuitem" onClick={youtube} className={item}>
            Open as a YouTube playlist
            <span className="block font-mono text-[10.5px] text-faint">your latest 50 songs, no account needed</span>
          </button>
        </div>
      )}
    </div>
  );
}
