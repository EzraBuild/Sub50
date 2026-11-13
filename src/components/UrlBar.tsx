import { useState, type FormEvent } from 'react';
import { parseYouTubeId } from '../shared/youtube';
import { PlayIcon, PlusIcon } from './icons';

interface Props {
  disabled: boolean;
  onPlayNow: (url: string) => void;
  onQueue: (url: string) => void;
}

export function UrlBar({ disabled, onPlayNow, onQueue }: Props) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (mode: 'play' | 'queue') => {
    const url = value.trim();
    if (!parseYouTubeId(url)) {
      setInvalid(true);
      return;
    }
    (mode === 'play' ? onPlayNow : onQueue)(url);
    setValue('');
    setInvalid(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit('play');
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder="Paste a YouTube link: watch, youtu.be, shorts, music…"
          aria-label="YouTube URL"
          aria-invalid={invalid}
          className={`h-11 w-full rounded-lg border bg-sunken px-3.5 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-faint focus:outline-none ${
            invalid ? 'border-bad/70' : 'border-line focus:border-line-strong'
          }`}
        />
        {invalid && (
          <p className="absolute -bottom-5 left-1 text-[11px] text-bad">That doesn&apos;t look like a YouTube link.</p>
        )}
      </div>
      <div className={`flex gap-2 ${invalid ? 'mt-4 sm:mt-0' : ''}`}>
        <button type="submit" className="btn-primary h-11 flex-1 sm:flex-none" disabled={disabled || !value.trim()}>
          <PlayIcon size={15} />
          Play Now
        </button>
        <button type="button" className="btn h-11 flex-1 sm:flex-none" disabled={disabled || !value.trim()} onClick={() => submit('queue')}>
          <PlusIcon size={16} />
          Queue
        </button>
      </div>
    </form>
  );
}
