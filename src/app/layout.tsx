import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { authEnabled } from '../lib/auth-config';
import { THEME_BOOT_SCRIPT } from '../lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sub50',
  description: 'Listen to YouTube in lockstep with friends, with sub-50ms drift.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#090b0a' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme before React hydrates, so the attribute differs from the server HTML on purpose.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
      </head>
      <body>
        {authEnabled ? (
          // Clerk's sign-in modal picks up the page's theme tokens, so it matches light and dark.
          <ClerkProvider
            appearance={{
              variables: {
                colorPrimary: 'var(--ink)',
                colorBackground: 'var(--panel)',
                colorForeground: 'var(--ink)',
                colorMutedForeground: 'var(--muted)',
                colorInput: 'var(--canvas)',
                colorInputForeground: 'var(--ink)',
                colorBorder: 'var(--line-strong)',
                colorPrimaryForeground: 'var(--canvas)',
                borderRadius: '0.625rem',
                fontFamily: 'var(--font-geist-sans)',
              },
            }}
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
