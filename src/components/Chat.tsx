import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS, type ChatMessage } from '../shared/protocol';
import { Avatar } from './Avatar';
import { SectionHead } from './Frame';
import { SendIcon } from './icons';

interface Props {
  messages: ChatMessage[];
  typingNames: string[];
  selfId: string;
  disabled: boolean;
  onSend: (text: string) => boolean;
  onTyping: () => void;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** Messages from the same person within this window share one header. */
const GROUP_MS = 2 * 60_000;

function typingLine(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

export function Chat({ messages, typingNames, selfId, disabled, onSend, onTyping }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastTypingRef = useRef(0);

  // Follow new messages only if the reader is already at the bottom (or it's their own).
  useLayoutEffect(() => {
    const el = listRef.current;
    const last = messages.at(-1);
    if (el && (stickRef.current || last?.peerId === selfId)) el.scrollTop = el.scrollHeight;
  }, [messages, selfId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (onSend(text)) setDraft('');
  };

  const change = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (value && now - lastTypingRef.current > 2000) {
      lastTypingRef.current = now;
      onTyping();
    }
  };

  return (
    <section aria-label="Chat" className="border-t border-line">
      <SectionHead index="04" title="Chat" meta={messages.length ? `${messages.length} msg${messages.length === 1 ? '' : 's'}` : 'say hi'} />

      <div ref={listRef} onScroll={onScroll} className="h-72 overflow-y-auto px-4 py-3 sm:px-5" aria-live="polite" aria-label="Messages">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="label">no messages yet</p>
            <p className="text-[13px] text-muted">Say hi — everyone in the room sees it live.</p>
          </div>
        ) : (
          <ol className="space-y-1">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const grouped = prev && prev.peerId === m.peerId && m.at - prev.at < GROUP_MS;
              const mine = m.peerId === selfId;
              return (
                <li key={m.id} className={`flex gap-2.5 ${grouped ? '' : 'pt-2.5 first:pt-0'}`}>
                  <span className="w-6 shrink-0">{!grouped && <Avatar id={m.peerId} name={m.name} size={24} className="mt-0.5" />}</span>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <p className="flex items-baseline gap-2">
                        <span className={`text-[12.5px] font-semibold ${mine ? 'text-brand' : 'text-ink'}`}>{mine ? 'you' : m.name}</span>
                        <span className="font-mono text-[10px] text-faint">{time(m.at)}</span>
                      </p>
                    )}
                    {/* Rendered as text: React escapes it, nothing is interpreted as HTML. */}
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{m.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <p className="h-5 px-4 font-mono text-[10.5px] text-muted sm:px-5" aria-live="polite">
        {typingLine(typingNames)}
      </p>

      <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
        <input
          value={draft}
          onChange={(e) => change(e.target.value)}
          maxLength={LIMITS.CHAT_MAX}
          disabled={disabled}
          placeholder={disabled ? 'Reconnecting…' : 'Message the room'}
          aria-label="Message"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-canvas px-3 text-[13px] text-ink transition-colors placeholder:text-faint focus:border-ink/40 focus:outline-none disabled:opacity-50"
        />
        <button type="submit" disabled={disabled || !draft.trim()} className="btn-primary h-10 px-3" aria-label="Send">
          <SendIcon size={16} />
        </button>
      </form>
    </section>
  );
}
