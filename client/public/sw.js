// Spill's service worker has one job: browser push. When the server
// whispers "someone replied", this is what turns it into the little
// notification on your phone or laptop — even with the tab closed.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* plain text push */ }
  const title = data.title || "Spill It";
  const options = {
    body: data.body || "Something happened on the wall.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.type === "message" && data.withUserId ? `msg-${data.withUserId}` : undefined,
    data: { postId: data.postId || null, withUserId: data.withUserId || null, type: data.type || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = "/"; // the app routes by state; the bell holds the detail
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if ("focus" in win) return win.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

// Take over as soon as a new worker lands, so push fixes ship fast.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
