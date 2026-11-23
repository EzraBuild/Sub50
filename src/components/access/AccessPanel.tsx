'use client';

import { useState, type FormEvent } from 'react';
import { CloseIcon, PlusIcon } from '../icons';

export interface AccessView {
  private: boolean;
  allowed: string[];
  owners: string[];
}

/** The owner's controls: the invite-only switch and the allowed emails. */
export function AccessPanel({ initial }: { initial: AccessView }) {
  const [view, setView] = useState(initial);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (change: { private?: boolean; allow?: string; remove?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
      const body = (await r.json()) as AccessView & { error?: string };
      if (!r.ok) throw new Error(body.error ?? 'That didn’t work.');
      setView(body);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (email.trim() && (await send({ allow: email }))) setEmail('');
  };

  return (
    <div className="divide-y divide-line">
      <section className="flex flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
        <div className="max-w-md">
          <p className="label">invite-only</p>
          <p className="mt-2 text-[14px] text-ink-2">
            {view.private
              ? 'On. Only you and the accounts below can use Sub50. Everyone else sees “Sub50 is private for now. Ask the owner for access.”'
              : 'Off. Anyone with a link can use Sub50.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={view.private}
          aria-label="Invite-only"
          disabled={busy}
          onClick={() => void send({ private: !view.private })}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${view.private ? 'border-brand bg-brand' : 'border-line-strong bg-sunken'}`}
        >
          <span className={`inline-block size-5 rounded-full bg-canvas shadow transition-transform ${view.private ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </section>

      <section className="px-4 py-6 sm:px-6">
        <p className="label">allowed accounts</p>
        <p className="mt-2 text-[13px] text-muted">They sign in with this email (verified) to get in. Removing someone locks them out within a few minutes.</p>
        <form onSubmit={add} className="mt-4 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            aria-label="Email to allow"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-3 font-mono text-[13px] text-ink placeholder:text-faint focus:border-ink/40 focus:outline-none"
          />
          <button type="submit" disabled={busy || !email.trim()} className="btn h-10 px-3 text-xs">
            <PlusIcon size={13} />
            Allow
          </button>
        </form>
        {error && <p className="mt-2 font-mono text-[11px] text-bad">{error}</p>}
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {view.owners.map((o) => (
            <li key={`owner-${o}`} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{o}</span>
              <span className="font-mono text-[10.5px] text-faint uppercase">owner</span>
            </li>
          ))}
          {view.allowed.map((a) => (
            <li key={a} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-2">{a}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ remove: a })}
                className="inline-flex size-8 items-center justify-center rounded-md text-faint transition hover:bg-sunken hover:text-ink"
                aria-label={`Remove ${a}`}
                title="Remove"
              >
                <CloseIcon size={13} />
              </button>
            </li>
          ))}
          {view.allowed.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">Nobody else yet.</li>}
        </ul>
      </section>
    </div>
  );
}
