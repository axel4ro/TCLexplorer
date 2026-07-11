(function () {
  const SETTINGS_KEY = "tclEventNotificationSettings";
  const DEFAULT_REMINDER_MINUTES = 15;
  const LEGACY_DEFAULT_REMINDER_MINUTES = 10;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const STATS_POLL_INTERVAL_MS = 5 * 60 * 1000;
  // Site-wide auto-subscribe: how often we retry the native permission prompt
  // while it's still undecided, and how long we honor an explicit Disable
  // before silently re-subscribing on a later visit (browser permission stays
  // granted even after our own UI toggle is switched off).
  const AUTO_PROMPT_COOLDOWN_MS = DAY_MS;
  const DISABLE_RESUBSCRIBE_COOLDOWN_MS = 60 * 60 * 1000;
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const copy = {
    en: {
      title: "Event notifications",
      checking: "Checking notification support...",
      unsupported: "This browser cannot receive event notifications.",
      denied: "Notifications are blocked. Enable them from browser settings for this site.",
      ready: "Enable reminders on this device. Each phone/browser must be enabled once.",
      enabledPush: "Active on this device. Push notifications can arrive even when the site/app is closed.",
      enabledLocal: "Local reminders are active. Configure the push API for closed-app delivery.",
      serverMissing: "Push API is not configured yet. Local reminders only on this device.",
      busy: "Updating notification settings...",
      enable: "Enable",
      disable: "Disable",
      test: "Test",
      subscribersUnit: "Subs",
      subscribersMeta: "Live",
      subscribersError: "Unavailable",
      enabledTitle: "Event notifications enabled",
      enabledBody: "You will receive reminders for weekly events on this device.",
      testTitle: "TCL event notification test",
      testBody: "Notifications are working on this device.",
      reminderTitle: "{name} starts in {minutes} min",
      liveTitle: "{name} is live now",
      midpointTitle: "{name} is halfway through",
      endTitle: "{name} has ended"
    },
    ro: {
      title: "Notificari events",
      checking: "Verific suportul pentru notificari...",
      unsupported: "Browserul acesta nu poate primi notificari pentru events.",
      denied: "Notificarile sunt blocate. Activeaza-le din setarile browserului pentru site.",
      ready: "Activeaza reminder-ele pe acest device. Fiecare telefon/browser trebuie activat o data.",
      enabledPush: "Activ pe acest device. Notificarile push pot ajunge si cu site-ul/app-ul inchis.",
      enabledLocal: "Reminder-ele locale sunt active. Configureaza API-ul push pentru livrare cu app-ul inchis.",
      serverMissing: "API-ul push nu este configurat inca. Doar reminder local pe acest device.",
      busy: "Actualizez setarile de notificari...",
      enable: "Activeaza",
      disable: "Opreste",
      test: "Test",
      subscribersUnit: "Subs",
      subscribersMeta: "Live",
      subscribersError: "Indisponibil",
      enabledTitle: "Notificari events activate",
      enabledBody: "Vei primi remindere pentru weekly events pe acest device.",
      testTitle: "Test notificare TCL event",
      testBody: "Notificarile functioneaza pe acest device.",
      reminderTitle: "{name} incepe in {minutes} min",
      liveTitle: "{name} este activ acum",
      midpointTitle: "{name} este la jumatate",
      endTitle: "{name} s-a incheiat"
    }
  };

  const state = {
    apiBase: "",
    busy: false,
    publicKey: "",
    pushServerConfigured: null,
    latestEvents: null,
    lang: "en",
    subscriberCount: null,
    statsTimer: null
  };

  function getLang() {
    const lang = String(window.currentLang || localStorage.getItem("lang") || navigator.language || "en").toLowerCase();
    return lang.split("-")[0] === "ro" ? "ro" : "en";
  }

  function tr(key, vars) {
    const table = copy[getLang()] || copy.en;
    let value = table[key] || copy.en[key] || key;
    Object.entries(vars || {}).forEach(([name, replacement]) => {
      value = value.split(`{${name}}`).join(String(replacement));
    });
    return value;
  }

  function getSettings() {
    try {
      const settings = {
        enabled: false,
        mode: "off",
        reminderMinutes: DEFAULT_REMINDER_MINUTES,
        ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {})
      };
      if (settings.reminderMinutes === LEGACY_DEFAULT_REMINDER_MINUTES) {
        settings.reminderMinutes = DEFAULT_REMINDER_MINUTES;
      }
      return settings;
    } catch (_) {
      return {
        enabled: false,
        mode: "off",
        reminderMinutes: DEFAULT_REMINDER_MINUTES
      };
    }
  }

  function saveSettings(next) {
    const settings = { ...getSettings(), ...next, updatedAt: new Date().toISOString() };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  function hasPushClaimReminder() {
    try {
      const settings = JSON.parse(localStorage.getItem("tclClaimReminderSettings") || "{}") || {};
      return Boolean(settings.enabled && settings.mode === "push");
    } catch (_) {
      return false;
    }
  }

  function normalizeApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getDefaultApiBase() {
    try {
      return new URL("api/push", window.location.href).href.replace(/\/+$/, "");
    } catch (_) {
      return "/api/push";
    }
  }

  function getApiBase() {
    if (!state.apiBase) {
      const configured = normalizeApiBase(window.TCL_EVENT_PUSH_CONFIG?.apiBaseUrl);
      state.apiBase = configured || getDefaultApiBase();
    }
    return state.apiBase;
  }

  function supportsNotifications() {
    return Boolean(window.isSecureContext && "serviceWorker" in navigator && "Notification" in window);
  }

  function supportsPush() {
    return supportsNotifications() && "PushManager" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function requestApi(path, options) {
    const url = `${getApiBase()}/${String(path).replace(/^\/+/, "")}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function getPushConfig() {
    const fallbackKey = String(window.TCL_EVENT_PUSH_CONFIG?.publicVapidKey || "").trim();
    if (fallbackKey) {
      state.publicKey = fallbackKey;
      state.pushServerConfigured = true;
      return fallbackKey;
    }

    if (state.publicKey || state.pushServerConfigured === false) return state.publicKey;

    try {
      const config = await requestApi("config", { method: "GET" });
      state.publicKey = String(config.publicKey || "").trim();
      state.pushServerConfigured = Boolean(config.configured && state.publicKey);
      return state.publicKey;
    } catch (error) {
      state.pushServerConfigured = false;
      return "";
    }
  }

  function setSubscriberCard(status, count) {
    const card = document.getElementById("eventSubscriberCard");
    const countEl = document.getElementById("eventSubscriberCount");
    const unit = document.getElementById("eventSubscriberUnit");
    const meta = document.getElementById("eventSubscriberMeta");
    if (!card || !countEl || !meta) return;

    card.dataset.state = status || "loading";
    if (unit) unit.textContent = tr("subscribersUnit");

    if (Number.isFinite(count)) {
      state.subscriberCount = count;
      countEl.textContent = String(count);
      meta.textContent = tr("subscribersMeta");
      card.setAttribute("aria-label", `${count} ${tr("subscribersUnit")} ${tr("subscribersMeta")}`);
      return;
    }

    if (Number.isFinite(state.subscriberCount)) {
      countEl.textContent = String(state.subscriberCount);
    } else {
      countEl.textContent = "--";
    }
    meta.textContent = status === "error" ? tr("subscribersError") : tr("subscribersMeta");
    card.setAttribute("aria-label", `${countEl.textContent} ${tr("subscribersUnit")} ${meta.textContent}`);
  }

  async function refreshSubscriberStats() {
    setSubscriberCard("loading");
    try {
      const stats = await requestApi("stats", { method: "GET" });
      setSubscriberCard("ready", Number(stats.subscribers));
      return stats;
    } catch (error) {
      console.warn("Subscriber stats refresh failed", error);
      setSubscriberCard("error");
      return null;
    }
  }

  function startSubscriberStatsPolling() {
    if (state.statsTimer) return;
    refreshSubscriberStats();
    state.statsTimer = window.setInterval(refreshSubscriberStats, STATS_POLL_INTERVAL_MS);

    window.addEventListener("focus", refreshSubscriberStats);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshSubscriberStats();
    });
  }

  async function getServiceWorkerRegistration() {
    if (!supportsNotifications()) return null;
    const swUrl = new URL("sw.js", window.location.href);
    const registration = await navigator.serviceWorker.register(swUrl, { updateViaCache: "none" });
    return registration.active ? registration : navigator.serviceWorker.ready;
  }

  function getSubscriptionPayload(subscription) {
    if (!subscription) return null;
    return typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  }

  function subscriptionMatchesKey(subscription, publicKey) {
    try {
      const currentKey = subscription?.options?.applicationServerKey;
      if (!currentKey) return true;
      const expected = urlBase64ToUint8Array(publicKey);
      const actual = new Uint8Array(currentKey);
      if (actual.length !== expected.length) return false;
      return actual.every((byte, index) => byte === expected[index]);
    } catch (_) {
      return true;
    }
  }

  async function ensureFreshSubscription(registration, publicKey) {
    const existing = await registration.pushManager.getSubscription();
    if (existing && subscriptionMatchesKey(existing, publicKey)) return existing;

    if (existing) await existing.unsubscribe().catch(() => {});
    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  async function subscribePush(registration) {
    if (!supportsPush()) return null;
    const publicKey = await getPushConfig();
    if (!publicKey) return null;

    const subscription = await ensureFreshSubscription(registration, publicKey);
    if (!subscription) return null;

    const settings = getSettings();
    const payload = {
      subscription: getSubscriptionPayload(subscription),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      lang: window.currentLang || getLang(),
      reminderMinutes: settings.reminderMinutes || DEFAULT_REMINDER_MINUTES,
      userAgent: navigator.userAgent || ""
    };

    await requestApi("subscribe", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return subscription;
  }

  async function restoreServerSubscription() {
    const settings = getSettings();
    if (!settings.enabled || settings.mode !== "push" || !supportsPush()) return null;
    if (Notification.permission !== "granted") return null;

    try {
      const registration = await getServiceWorkerRegistration();
      const subscription = await subscribePush(registration);
      if (subscription) {
        await refreshSubscriberStats();
      }
      return subscription;
    } catch (error) {
      console.warn("Push subscription restore failed", error);
      return null;
    }
  }

  async function unregisterPush(registration) {
    if (!supportsPush() || !registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await requestApi("unsubscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: getSubscriptionPayload(subscription) })
      });
    } catch (error) {
      console.warn("Push unsubscribe API failed", error);
    }

    if (!hasPushClaimReminder()) {
      await subscription.unsubscribe();
    }
  }

  function getTranslatedEvent(event) {
    const translations = window.translations?.events?.[event.name] || {};
    return {
      name: translations.name || event.name || "TCL Event",
      description: translations.desc || event.description || "The Cursed Land weekly event"
    };
  }

  function getTodayIndex(date) {
    return (date.getUTCDay() + 6) % 7;
  }

  function getEventOccurrence(day, event, now) {
    const targetIndex = WEEKDAYS.indexOf(day);
    if (targetIndex < 0 || !event.start || !event.end) return null;

    const [startHour, startMinute] = String(event.start).split(":").map(Number);
    const [endHour, endMinute] = String(event.end).split(":").map(Number);
    if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;

    const dayOffset = (targetIndex - getTodayIndex(now) + 7) % 7;
    let start = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + dayOffset,
      startHour,
      startMinute
    ));
    let end = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + dayOffset,
      endHour,
      endMinute
    ));

    if (end <= start) end = new Date(end.getTime() + DAY_MS);
    if (end < now) {
      start = new Date(start.getTime() + 7 * DAY_MS);
      end = new Date(end.getTime() + 7 * DAY_MS);
    }

    return { start, end };
  }

  function buildLocalSchedule(eventsData) {
    const settings = getSettings();
    const reminderMinutes = Number(settings.reminderMinutes) || DEFAULT_REMINDER_MINUTES;
    const now = new Date();
    const minTriggerAt = Date.now() + 15 * 1000;
    const maxTriggerAt = Date.now() + 8 * DAY_MS;
    const notifications = [];

    Object.entries(eventsData || {}).forEach(([day, events]) => {
      (events || []).forEach((event) => {
        const occurrence = getEventOccurrence(day, event, now);
        if (!occurrence) return;

        const translated = getTranslatedEvent(event);
        const startAt = occurrence.start.getTime();
        const endAt = occurrence.end.getTime();
        const midpointAt = startAt + Math.round((endAt - startAt) / 2);
        const reminderAt = startAt - reminderMinutes * 60 * 1000;
        const baseId = `${day}:${event.name}:${event.start}:${startAt}`;
        const body = translated.description;
        const reminderTitleTemplate = tr("reminderTitle", { name: translated.name, minutes: "{minutes}" });

        [
          {
            id: `${baseId}:reminder:${reminderMinutes}`,
            triggerAt: reminderAt,
            type: "reminder",
            startAt,
            title: tr("reminderTitle", { name: translated.name, minutes: reminderMinutes }),
            titleTemplate: reminderTitleTemplate,
            body
          },
          {
            id: `${baseId}:live`,
            triggerAt: startAt,
            title: tr("liveTitle", { name: translated.name }),
            body
          },
          {
            id: `${baseId}:midpoint`,
            triggerAt: midpointAt,
            title: tr("midpointTitle", { name: translated.name }),
            body
          },
          {
            id: `${baseId}:end`,
            triggerAt: endAt,
            title: tr("endTitle", { name: translated.name }),
            body
          }
        ].forEach((item) => {
          if (item.triggerAt < minTriggerAt || item.triggerAt > maxTriggerAt) return;
          notifications.push({
            ...item,
            url: "index.html#events",
            tag: `tcl-event-${item.id}`.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
          });
        });
      });
    });

    return notifications.sort((a, b) => a.triggerAt - b.triggerAt).slice(0, 80);
  }

  async function postScheduleToServiceWorker(notifications) {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    if (!target) return;
    target.postMessage({
      type: "tcl-events:schedule",
      notifications
    });
  }

  async function clearLocalSchedule() {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: "tcl-events:clear-schedule" });
  }

  async function syncEvents(eventsData) {
    if (eventsData) state.latestEvents = eventsData;
    const settings = getSettings();
    refreshStatus();
    if (!settings.enabled || !state.latestEvents) return [];

    const notifications = buildLocalSchedule(state.latestEvents);
    await postScheduleToServiceWorker(notifications).catch((error) => {
      console.warn("Unable to schedule local event notifications", error);
    });
    return notifications;
  }

  function setPanelText(statusKey) {
    const title = document.getElementById("eventsNotificationTitle");
    const status = document.getElementById("eventsNotificationStatus");
    if (title) title.textContent = tr("title");
    if (status) status.textContent = tr(statusKey);
  }

  function refreshStatus() {
    const panel = document.getElementById("eventsNotificationPanel");
    const enableBtn = document.getElementById("enableEventNotificationsBtn");
    const disableBtn = document.getElementById("disableEventNotificationsBtn");
    const testBtn = document.getElementById("testEventNotificationsBtn");
    if (!panel || !enableBtn || !disableBtn || !testBtn) return;

    enableBtn.textContent = tr("enable");
    disableBtn.textContent = tr("disable");
    testBtn.textContent = tr("test");

    const settings = getSettings();
    panel.dataset.state = settings.enabled ? settings.mode : "ready";

    if (state.busy) {
      setPanelText("busy");
      enableBtn.disabled = true;
      disableBtn.disabled = true;
      testBtn.disabled = true;
      return;
    }

    enableBtn.disabled = false;
    disableBtn.disabled = false;
    testBtn.disabled = false;

    if (!supportsNotifications()) {
      setPanelText("unsupported");
      enableBtn.hidden = true;
      disableBtn.hidden = true;
      testBtn.hidden = true;
      return;
    }

    if (Notification.permission === "denied") {
      setPanelText("denied");
      enableBtn.hidden = true;
      disableBtn.hidden = !settings.enabled;
      testBtn.hidden = true;
      return;
    }

    if (settings.enabled) {
      setPanelText(settings.mode === "push" ? "enabledPush" : "enabledLocal");
      enableBtn.hidden = true;
      disableBtn.hidden = false;
      testBtn.hidden = false;
      return;
    }

    setPanelText(state.pushServerConfigured === false ? "serverMissing" : "ready");
    enableBtn.hidden = false;
    disableBtn.hidden = true;
    testBtn.hidden = true;
  }

  async function enableNotifications() {
    state.busy = true;
    refreshStatus();

    try {
      if (!supportsNotifications()) throw new Error("Notifications are not supported");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        saveSettings({ enabled: false, mode: "off" });
        return;
      }

      const registration = await getServiceWorkerRegistration();
      let mode = "local";

      try {
        const subscription = await subscribePush(registration);
        if (subscription) mode = "push";
      } catch (error) {
        console.warn("Push subscription failed; local reminders remain available", error);
        state.pushServerConfigured = false;
      }

      saveSettings({ enabled: true, mode });
      await syncEvents(state.latestEvents || window.eventsData || null);
      await refreshSubscriberStats();
      await showImmediate(tr("enabledTitle"), tr("enabledBody"), {
        force: true,
        tag: "tcl-event-notifications-enabled"
      });
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  async function disableNotifications() {
    state.busy = true;
    refreshStatus();
    try {
      const registration = await getServiceWorkerRegistration().catch(() => null);
      await unregisterPush(registration);
      await clearLocalSchedule();
      saveSettings({ enabled: false, mode: "off", disabledAt: Date.now() });
      await refreshSubscriberStats();
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  async function showImmediate(title, body, options) {
    const settings = getSettings();
    if (!options?.force && !settings.enabled) return false;
    if (!supportsNotifications() || Notification.permission !== "granted") return false;

    const notificationOptions = {
      body,
      icon: "images/tcl_icon.png",
      badge: "images/tcl_icon.png",
      tag: options?.tag || "tcl-event-notification",
      renotify: true,
      data: {
        url: options?.url || "index.html#events"
      }
    };

    try {
      const registration = await getServiceWorkerRegistration();
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch (error) {
      try {
        new Notification(title, notificationOptions);
        return true;
      } catch (fallbackError) {
        console.warn("Notification display failed", fallbackError);
        return false;
      }
    }
  }

  async function testNotifications() {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (settings.mode === "push" && supportsPush()) {
      try {
        const registration = await getServiceWorkerRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await requestApi("test", {
            method: "POST",
            body: JSON.stringify({
              subscription: getSubscriptionPayload(subscription),
              payload: {
                title: tr("testTitle"),
                body: tr("testBody"),
                url: "index.html#events",
                tag: "tcl-event-test"
              }
            })
          });
          return;
        }
      } catch (error) {
        console.warn("Remote push test failed; showing local test", error);
      }
    }

    await showImmediate(tr("testTitle"), tr("testBody"), {
      force: true,
      tag: "tcl-event-test"
    });
  }

  /**
   * Runs on every page (not just the Events tab). Decides, without requiring
   * a click on our own UI, whether to show the browser's native permission
   * prompt (first-time visitors) or silently re-subscribe (permission already
   * granted, either restoring an active subscription or reinstating one the
   * visitor had explicitly disabled, after a cooldown so Disable doesn't look
   * broken for the rest of that same visit).
   */
  async function autoManagePushSubscription() {
    if (!supportsNotifications()) return;

    const settings = getSettings();

    if (Notification.permission === "granted" && settings.enabled) {
      await restoreServerSubscription();
      await syncEvents(window.eventsData || null);
      return;
    }

    if (Notification.permission === "denied") return;

    if (Notification.permission === "default") {
      const lastPromptAt = Number(settings.lastAutoPromptAt) || 0;
      if (Date.now() - lastPromptAt < AUTO_PROMPT_COOLDOWN_MS) return;
      saveSettings({ lastAutoPromptAt: Date.now() });
      await enableNotifications();
      return;
    }

    // Notification.permission === "granted" here, but our own settings say
    // disabled — either never enabled on this device, or explicitly disabled.
    const disabledAt = Number(settings.disabledAt) || 0;
    if (disabledAt && Date.now() - disabledAt < DISABLE_RESUBSCRIBE_COOLDOWN_MS) return;

    await enableNotifications();
  }

  function bindControls() {
    document.getElementById("enableEventNotificationsBtn")?.addEventListener("click", () => {
      enableNotifications().catch((error) => {
        console.error("Enable notifications failed", error);
        state.busy = false;
        refreshStatus();
      });
    });
    document.getElementById("disableEventNotificationsBtn")?.addEventListener("click", () => {
      disableNotifications().catch((error) => {
        console.error("Disable notifications failed", error);
        state.busy = false;
        refreshStatus();
      });
    });
    document.getElementById("testEventNotificationsBtn")?.addEventListener("click", () => {
      testNotifications().catch((error) => console.error("Notification test failed", error));
    });
  }

  async function boot() {
    state.lang = getLang();
    bindControls();
    refreshStatus();
    setSubscriberCard("loading");
    await getPushConfig();
    refreshStatus();
    startSubscriberStatsPolling();

    await autoManagePushSubscription();
  }

  window.TCLEventNotifications = {
    enable: enableNotifications,
    disable: disableNotifications,
    refreshStatus,
    refreshSubscriberStats,
    showImmediate,
    syncEvents,
    setLanguage(lang) {
      state.lang = lang || getLang();
      refreshStatus();
      setSubscriberCard("ready", state.subscriberCount);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot().catch(console.error), { once: true });
  } else {
    boot().catch(console.error);
  }
})();
