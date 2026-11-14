import { authEnabled } from '../../lib/auth-config';
import { AccountButton } from '../Account';
import { LogoMark } from '../icons';
import { ThemeToggle } from '../ThemeToggle';

/** Header for the pages outside a room (/me, /p/…): logo back to a new room, theme, account. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[900px] items-stretch border-line min-[901px]:border-x">
        <a href="/" className="flex items-center gap-2.5 px-4 sm:px-5" aria-label="Sub50 (new room)">
          <LogoMark size={20} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Sub<span className="text-lock">50</span>
          </span>
        </a>
        <div className="ml-auto flex items-stretch">
          <div className="cell px-1.5 sm:px-2">
            <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink" />
          </div>
          {authEnabled && (
            <div className="cell px-1.5 sm:px-2">
              <AccountButton />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
