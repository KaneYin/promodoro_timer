// Notification delivery/click handling only. No fetch interception, caching,
// background timer scheduling or push subscription is installed.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = windows.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === "/");
    if (app) await app.focus();
    else await self.clients.openWindow("/");
  })());
});
