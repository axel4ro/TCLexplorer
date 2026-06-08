const SERVICE_WORKER_VERSION = "20260608-11";
const ICON_URL = new URL("images/tcl_icon.png", self.registration.scope).href;
const DB_NAME = "tcl-event-notifications";
const DB_VERSION = 1;
const SCHEDULE_STORE = "schedule";
const EVENT_SOURCE = "events";
const CLAIM_SOURCE = "claim";
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

function getNotificationSource(notification) {
  if (notification?.source) return notification.source;
  return String(notification?.id || "").startsWith("claim:") ? CLAIM_SOURCE : EVENT_SOURCE;
}

function belongsToSource(notification, source) {
  return getNotificationSource(notification) === source;
}

async function replaceSchedule(notifications, source) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      (request.result || []).forEach((notification) => {
        if (belongsToSource(notification, source)) store.delete(notification.id);
      });
      (notifications || []).forEach((notification) => {
        store.put({
          ...notification,
          source
        });
      });
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function clearSchedule(source) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCHEDULE_STORE, "readwrite");
    const store = tx.objectStore(SCHEDULE_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      (request.result || []).forEach((notification) => {
        if (belongsToSource(notification, source)) store.delete(notification.id);
      });
    };
    request.onerror = () => reject(request.error);
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

function getDisplayTitle(payload) {
  if (payload.type === "claim-reminder" && payload.titleTemplate && payload.expiresAt) {
    const days = Math.max(0, Math.ceil((Number(payload.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)));
    return String(payload.titleTemplate).split("{days}").join(String(days));
  }

  if (payload.type !== "reminder" || !payload.titleTemplate || !payload.startAt) {
    return payload.title || "TCL Event";
  }

  const minutes = Math.max(0, Math.ceil((Number(payload.startAt) - Date.now()) / 60000));
  return String(payload.titleTemplate).split("{minutes}").join(String(minutes));
}

async function showEventNotification(payload) {
  const targetUrl = new URL(payload.url || "index.html#events", self.registration.scope).href;
  await self.registration.showNotification(getDisplayTitle(payload), {
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
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    windows.forEach((client) => {
      client.postMessage({
        type: "tcl:service-worker-updated",
        version: SERVICE_WORKER_VERSION
      });
    });
    const notifications = await readSchedule().catch(() => []);
    scheduleLocalNotifications(notifications);
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "tcl-events:schedule") {
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    event.waitUntil((async () => {
      await replaceSchedule(notifications, EVENT_SOURCE);
      scheduleLocalNotifications(await readSchedule());
    })());
  }

  if (data.type === "tcl-events:clear-schedule") {
    event.waitUntil((async () => {
      await clearSchedule(EVENT_SOURCE);
      scheduleLocalNotifications(await readSchedule());
    })());
  }

  if (data.type === "tcl-claim:schedule") {
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    event.waitUntil((async () => {
      await replaceSchedule(notifications, CLAIM_SOURCE);
      scheduleLocalNotifications(await readSchedule());
    })());
  }

  if (data.type === "tcl-claim:clear-schedule") {
    event.waitUntil((async () => {
      await clearSchedule(CLAIM_SOURCE);
      scheduleLocalNotifications(await readSchedule());
    })());
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  // Cancel local timer for this specific event to avoid duplicate notification
  if (payload.id) {
    const timer = localTimers.get(payload.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      localTimers.delete(payload.id);
    }
  }
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
