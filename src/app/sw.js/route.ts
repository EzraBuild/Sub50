// Service worker for chat notifications: focuses (or reopens) the room when one is clicked.
// No fetch handler on purpose: it never intercepts requests or caches anything.
const SW = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const target = wins.find((w) => url && w.url === url) || wins[0];
      if (target) return target.focus();
      if (url) return self.clients.openWindow(url);
    }),
  );
});
`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
}
