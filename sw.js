const ICON_URL = new URL("images/tcl_icon.png", self.registration.scope).href;
const DB_NAME = "tcl-event-notifications";
const DB_VERSION = 1;
const SCHEDULE_STORE = "schedule";
const MAX_TIMEOUT_MS = 2147483647;
const localTimers = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSchedule(notifications) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    store.clear();
    (notifications || []).forEach((notification) => store.put(notification));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readSchedule() {
  const db = await openDb();
  const notifications = await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readonly");
    const request = tx.objectStore(SCHEDULE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return notifications;
}

function clearLocalTimers() {
  localTimers.forEach((timer) => clearTimeout(timer));
  localTimers.clear();
}

async function showEventNotification(payload) {
  const targetUrl = new URL(payload.url || "index.html#events", self.registration.scope).href;
  await self.registration.showNotification(payload.title || "TCL Event", {
    body: payload.body || "The Cursed Land event reminder",
    icon: payload.icon || ICON_URL,
    badge: payload.badge || ICON_URL,
    tag: payload.tag || "tcl-event-notification",
    renotify: payload.renotify !== false,
    timestamp: payload.timestamp || payload.triggerAt || Date.now(),
    data: {
      url: targetUrl
    }
  });
}

function scheduleLocalNotifications(notifications) {
  clearLocalTimers();
  const now = Date.now();

  (notifications || []).forEach((notification) => {
    const triggerAt = Number(notification.triggerAt);
    const delay = triggerAt - now;
    if (!Number.isFinite(triggerAt) || delay <= 0 || delay > MAX_TIMEOUT_MS) return;

    const timer = setTimeout(() => {
      localTimers.delete(notification.id);
      showEventNotification(notification).catch((error) => {
        console.warn("Local event notification failed", error);
      });
    }, delay);

    localTimers.set(notification.id, timer);
  });
}

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch (_) {
    return {
      title: "TCL Event",
      body: event.data.text()
    };
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const notifications = await readSchedule().catch(() => []);
    scheduleLocalNotifications(notifications);
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "tcl-events:schedule") {
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    event.waitUntil((async () => {
      await saveSchedule(notifications);
      scheduleLocalNotifications(notifications);
    })());
  }

  if (data.type === "tcl-events:clear-schedule") {
    event.waitUntil((async () => {
      await saveSchedule([]);
      clearLocalTimers();
    })());
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  event.waitUntil(showEventNotification(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "index.html#events", self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windows) {
      const clientUrl = new URL(client.url);
      const target = new URL(targetUrl);
      if (clientUrl.origin !== target.origin) continue;
      if ("navigate" in client) await client.navigate(targetUrl);
      if ("focus" in client) return client.focus();
    }

    return self.clients.openWindow(targetUrl);
  })());
});
