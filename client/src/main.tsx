import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Placeholder shell; the real app lands in #7.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="flex min-h-dvh items-center justify-center">
      <p className="font-mono text-sm text-zinc-500">
        Sub<span className="text-emerald-400">50</span> · scaffold
      </p>
    </main>
  </StrictMode>,
);
