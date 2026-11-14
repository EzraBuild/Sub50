import { useState, type FormEvent } from 'react';
import { parseYouTubeId } from '../shared/youtube';
import { LinkIcon, PlayIcon, PlusIcon } from './icons';

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
        <LinkIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
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
          placeholder="youtube.com/watch?v=… · youtu.be/… · shorts · music"
          id="link-input"
          aria-label="YouTube URL"
          aria-invalid={invalid}
          className={`h-12 w-full rounded-lg border bg-panel pr-3.5 pl-10 font-mono text-[13px] text-ink shadow-sm shadow-shade/30 transition-colors placeholder:text-faint focus:outline-none ${
            invalid ? 'border-bad/70' : 'border-line-strong focus:border-ink/40'
          }`}
        />
        {invalid && <p className="absolute -bottom-5 left-1 font-mono text-[11px] text-bad">not a YouTube link</p>}
      </div>
      <div className={`flex gap-2 ${invalid ? 'mt-4 sm:mt-0' : ''}`}>
        <button type="submit" className="btn-primary h-12 flex-1 px-4 sm:flex-none" disabled={disabled || !value.trim()}>
          <PlayIcon size={14} />
          Play now
        </button>
        <button type="button" className="btn h-12 flex-1 px-4 sm:flex-none" disabled={disabled || !value.trim()} onClick={() => submit('queue')}>
          <PlusIcon size={15} />
          Queue
        </button>
      </div>
    </form>
  );
}
