const ALLOWED_PREFIXES = [
  "/notifications",
  "/messages",
  "/employee",
  "/accountant",
  "/intern",
  "/nysc",
  "/attendance",
  "/leave",
  "/meetings",
  "/events",
  "/tasks",
  "/targets",
  "/expenses",
  "/payroll",
  "/announcements",
  "/bills",
  "/procurement",
  "/dashboard",
  "/hr",
  "/manager",
  "/super-admin",
  "/profile",
  "/home",
  "/check-in",
  "/settings",
];

function safeDestination(url) {
  if (!url || typeof url !== "string") {
    return "/check-in";
  }
  const destination = url.trim();
  if (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\") || destination.includes("://")) {
    return "/check-in";
  }
  const pathOnly = destination.split("?")[0].split("#")[0];
  const allowed = ALLOWED_PREFIXES.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`));
  return allowed ? destination : "/check-in";
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_error) {
    payload = { title: "Notification", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Notification";
  const options = {
    body: payload.body || payload.message || "",
    data: { url: safeDestination(payload.destinationUrl || payload.url) },
    icon: "/pwa/icons/icon.svg",
    badge: "/pwa/icons/icon.svg",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeDestination(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url && "focus" in client);
      if (existing) {
        existing.navigate(destination);
        return existing.focus();
      }
      return self.clients.openWindow(destination);
    })
  );
});
