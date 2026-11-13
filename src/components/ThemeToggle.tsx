'use client';

import { useEffect, useState } from 'react';
import { applyTheme, readThemeChoice, type ThemeChoice } from '../lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Cycles system → light → dark. "System" keeps following the OS while the page is open. */
export function ThemeToggle({ className = 'icon-btn' }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [choice]);

  const Icon = ICON[choice];
  return (
    <button
      type="button"
      onClick={() => setChoice(NEXT[choice])}
      className={className}
      aria-label={`Theme: ${choice}. Switch to ${NEXT[choice]}.`}
      title={`Theme: ${choice}`}
    >
      <Icon size={16} />
    </button>
  );
}
