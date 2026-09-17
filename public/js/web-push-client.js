const PUSH_DECLINED_KEY = "wms_push_declined";

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function getPushCapability() {
  const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const iosNeedsInstall = isIosDevice() && !isStandaloneDisplay();
  return {
    supported,
    permission,
    iosNeedsInstall,
    declined: window.localStorage.getItem(PUSH_DECLINED_KEY) === "1",
  };
}

export async function registerPushServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function enablePushNotifications({ apiOrigin, token, publicKey }) {
  const capability = getPushCapability();
  if (capability.iosNeedsInstall) {
    throw new Error("On iPhone and iPad, add this app to your Home Screen before enabling push notifications.");
  }
  if (!capability.supported) {
    throw new Error("Web Push is not supported in this browser. The in-app notification centre remains available.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    window.localStorage.setItem(PUSH_DECLINED_KEY, "1");
    throw new Error("Notification permission was not granted. You can still use the in-app notification centre.");
  }
  await registerPushServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const response = await fetch(`${apiOrigin}/api/v1/notifications/push/subscribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(subscription),
  });
  return response.json();
}

export async function disablePushNotifications({ apiOrigin, token }) {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await fetch(`${apiOrigin}/api/v1/notifications/push/unsubscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
}

export function rememberPushDeclined() {
  window.localStorage.setItem(PUSH_DECLINED_KEY, "1");
}
