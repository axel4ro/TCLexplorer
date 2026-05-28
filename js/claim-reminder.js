(function () {
  const SETTINGS_KEY = "tclClaimReminderSettings";
  const EVENT_SETTINGS_KEY = "tclEventNotificationSettings";
  const DEFAULT_EARLY_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_LOCAL_WINDOW_MS = 24 * DAY_MS;
  const STATUS_TICK_MS = 60 * 1000;
  const STATS_POLL_INTERVAL_MS = 5 * 60 * 1000;

  const copy = {
    en: {
      pageTitle: "Claim Reminder",
      pageIntro: "Keep automatic claim days on a separate notification track from weekly events.",
      panelTitle: "Staking claim notifications",
      checking: "Checking notification support...",
      unsupported: "This browser cannot receive claim reminders.",
      denied: "Notifications are blocked. Enable them from browser settings for this site.",
      ready: "Enter remaining days, then save the reminder on this device.",
      enabledPush: "Active on this device. You will receive a notification {earlyAlert} and on the final day.",
      enabledLocal: "Local reminder saved. You will receive a notification {earlyAlert} and on the final day.",
      serverMissing: "Cloudflare push is not configured yet. Local reminders only.",
      busy: "Updating claim reminder...",
      saved: "Claim reminder saved.",
      disabled: "Claim reminder disabled.",
      save: "Save / Update",
      test: "Test",
      disable: "Disable",
      labelLabel: "Reminder name",
      labelPlaceholder: "Automatic claim",
      daysLabel: "Days remaining",
      earlyLabel: "Early alert",
      earlySuffix: "days before",
      summaryEmpty: "No claim reminder is active.",
      summaryActive: "{days} days left",
      summaryExpired: "0 days left",
      expiresAt: "Ends around {date}",
      nextAlert: "Next alert: {date}",
      noFutureAlert: "No future alert scheduled.",
      summaryLabel: "Status",
      enabledTitle: "Claim reminder enabled",
      enabledBody: "You will receive claim reminders on this device.",
      testTitle: "TCL claim reminder test",
      testBody: "Claim reminders are working on this device.",
      reminderCountUnit: "Reminders",
      reminderCountMeta: "Live",
      reminderCountError: "Unavailable",
      invalidDays: "Enter at least 1 day.",
      invalidEarly: "Early alert must be at least 1 day."
    },
    ro: {
      pageTitle: "Claim Reminder",
      pageIntro: "Tine zilele pentru revendicare automata separat de notificarile pentru evenimente.",
      panelTitle: "Notificari staking claim",
      checking: "Verific suportul pentru notificari...",
      unsupported: "Browserul acesta nu poate primi reminder-e pentru claim.",
      denied: "Notificarile sunt blocate. Activeaza-le din setarile browserului pentru site.",
      ready: "Introdu zilele ramase, apoi salveaza reminder-ul pe acest device.",
      enabledPush: "Activ pe acest device. Vei primi notificare cu {earlyAlert} si in ultima zi.",
      enabledLocal: "Reminder local salvat. Vei primi notificare cu {earlyAlert} si in ultima zi.",
      serverMissing: "Cloudflare push nu este configurat inca. Doar reminder local.",
      busy: "Actualizez claim reminder...",
      saved: "Claim reminder salvat.",
      disabled: "Claim reminder oprit.",
      save: "Salveaza / Update",
      test: "Test",
      disable: "Opreste",
      labelLabel: "Nume reminder",
      labelPlaceholder: "Revendicare automata",
      daysLabel: "Zile ramase",
      earlyLabel: "Alerta devreme",
      earlySuffix: "zile inainte",
      summaryEmpty: "Nu este activ niciun claim reminder.",
      summaryActive: "Mai ai {days} zile",
      summaryExpired: "0 zile ramase",
      expiresAt: "Se termina aproximativ pe {date}",
      nextAlert: "Urmatoarea alerta: {date}",
      noFutureAlert: "Nu exista alerta viitoare programata.",
      summaryLabel: "Status",
      enabledTitle: "Claim reminder activat",
      enabledBody: "Vei primi reminder-e pentru claim pe acest device.",
      testTitle: "Test claim reminder TCL",
      testBody: "Reminder-ele pentru claim functioneaza pe acest device.",
      reminderCountUnit: "Remindere",
      reminderCountMeta: "Live",
      reminderCountError: "Indisponibil",
      invalidDays: "Introdu cel putin 1 zi.",
      invalidEarly: "Alerta devreme trebuie sa fie de cel putin 1 zi."
    }
  };

  const state = {
    apiBase: "",
    busy: false,
    publicKey: "",
    pushServerConfigured: null,
    statusTimer: null,
    statsTimer: null,
    reminderCount: null,
    lang: "en"
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
      return {
        enabled: false,
        mode: "off",
        label: tr("labelPlaceholder"),
        earlyDays: DEFAULT_EARLY_DAYS,
        expiresAt: null,
        id: "",
        ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {})
      };
    } catch (_) {
      return {
        enabled: false,
        mode: "off",
        label: tr("labelPlaceholder"),
        earlyDays: DEFAULT_EARLY_DAYS,
        expiresAt: null,
        id: ""
      };
    }
  }

  function saveSettings(next) {
    const settings = { ...getSettings(), ...next, updatedAt: new Date().toISOString() };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  function hasPushEventNotifications() {
    try {
      const settings = JSON.parse(localStorage.getItem(EVENT_SETTINGS_KEY) || "{}") || {};
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

  function setClaimReminderCountCard(status, count) {
    const card = document.getElementById("claimReminderCountCard");
    const countEl = document.getElementById("claimReminderCount");
    const unit = document.getElementById("claimReminderCountUnit");
    const meta = document.getElementById("claimReminderCountMeta");
    if (!card || !countEl || !meta) return;

    card.dataset.state = status || "loading";
    if (unit) unit.textContent = tr("reminderCountUnit");

    if (Number.isFinite(count)) {
      state.reminderCount = count;
      countEl.textContent = String(count);
      meta.textContent = tr("reminderCountMeta");
      card.setAttribute("aria-label", `${count} ${tr("reminderCountUnit")} ${tr("reminderCountMeta")}`);
      return;
    }

    if (Number.isFinite(state.reminderCount)) {
      countEl.textContent = String(state.reminderCount);
    } else {
      countEl.textContent = "--";
    }
    meta.textContent = status === "error" ? tr("reminderCountError") : tr("reminderCountMeta");
    card.setAttribute("aria-label", `${countEl.textContent} ${tr("reminderCountUnit")} ${meta.textContent}`);
  }

  async function refreshClaimReminderStats() {
    setClaimReminderCountCard("loading");
    try {
      const stats = await requestApi("claim/stats", { method: "GET" });
      setClaimReminderCountCard("ready", Number(stats.reminders));
      return stats;
    } catch (error) {
      console.warn("Claim reminder stats refresh failed", error);
      setClaimReminderCountCard("error");
      return null;
    }
  }

  function startClaimReminderStatsPolling() {
    if (state.statsTimer) return;
    refreshClaimReminderStats();
    state.statsTimer = window.setInterval(refreshClaimReminderStats, STATS_POLL_INTERVAL_MS);

    window.addEventListener("focus", refreshClaimReminderStats);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshClaimReminderStats();
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

  async function subscribePush(registration) {
    if (!supportsPush()) return null;
    const publicKey = await getPushConfig();
    if (!publicKey) return null;

    const existing = await registration.pushManager.getSubscription();
    return existing || registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  function readForm() {
    const label = String(document.getElementById("claimReminderLabel")?.value || tr("labelPlaceholder")).trim() || tr("labelPlaceholder");
    const days = Math.round(Number(document.getElementById("claimRemainingDays")?.value));
    const earlyDays = Math.round(Number(document.getElementById("claimEarlyDays")?.value || DEFAULT_EARLY_DAYS));
    return { label, days, earlyDays };
  }

  function isValidPositiveDays(value) {
    return Number.isFinite(value) && value >= 1;
  }

  function localUpsert(form) {
    const current = getSettings();
    const now = Date.now();
    return {
      enabled: true,
      mode: "local",
      label: form.label,
      earlyDays: form.earlyDays,
      expiresAt: now + form.days * DAY_MS,
      id: current.id || "",
      lastAction: "set",
      lastInputDays: form.days
    };
  }

  async function upsertReminder() {
    const form = readForm();
    if (!isValidPositiveDays(form.days)) {
      setStatusText("invalidDays");
      return null;
    }
    if (!isValidPositiveDays(form.earlyDays)) {
      setStatusText("invalidEarly");
      return null;
    }

    state.busy = true;
    refreshStatus();

    try {
      if (!supportsNotifications()) throw new Error("Notifications are not supported");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        saveSettings({ enabled: false, mode: "off" });
        return null;
      }

      const registration = await getServiceWorkerRegistration();
      let nextSettings = localUpsert(form);

      try {
        const subscription = await subscribePush(registration);
        if (subscription) {
          const result = await requestApi("claim/upsert", {
            method: "POST",
            body: JSON.stringify({
              action: "set",
              days: form.days,
              earlyDays: form.earlyDays,
              label: form.label,
              subscription: getSubscriptionPayload(subscription),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
              lang: window.currentLang || getLang(),
              userAgent: navigator.userAgent || ""
            })
          });

          if (result.reminder) {
            nextSettings = {
              enabled: true,
              mode: "push",
              id: result.reminder.id || "",
              label: result.reminder.label || form.label,
              earlyDays: Number(result.reminder.earlyDays) || form.earlyDays,
              expiresAt: Number(result.reminder.expiresAt) || nextSettings.expiresAt,
              lastAction: "set",
              lastInputDays: form.days
            };
            state.pushServerConfigured = true;
          }
        }
      } catch (error) {
        console.warn("Claim reminder push upsert failed; local reminder remains available", error);
        state.pushServerConfigured = false;
      }

      const saved = saveSettings(nextSettings);
      syncFormFromSettings(saved);
      await syncLocalSchedule(saved);
      await showImmediate(tr("enabledTitle"), tr("enabledBody"), {
        force: true,
        tag: "tcl-claim-reminder-enabled"
      });
      await refreshClaimReminderStats();
      setStatusText("saved");
      return saved;
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  async function unregisterRemoteReminder(registration) {
    if (!supportsPush() || !registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await requestApi("claim/delete", {
        method: "POST",
        body: JSON.stringify({ subscription: getSubscriptionPayload(subscription) })
      });
    } catch (error) {
      console.warn("Claim reminder delete API failed", error);
    }

    if (!hasPushEventNotifications()) {
      await subscription.unsubscribe();
    }
  }

  async function disableReminder() {
    state.busy = true;
    refreshStatus();
    try {
      const registration = await getServiceWorkerRegistration().catch(() => null);
      await unregisterRemoteReminder(registration);
      await clearLocalSchedule();
      saveSettings({ enabled: false, mode: "off", expiresAt: null });
      await refreshClaimReminderStats();
      setStatusText("disabled");
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  function buildLocalSchedule(settings = getSettings()) {
    if (!settings.enabled || !Number.isFinite(Number(settings.expiresAt))) return [];
    const expiresAt = Number(settings.expiresAt);
    const earlyDays = Math.max(1, Math.round(Number(settings.earlyDays) || DEFAULT_EARLY_DAYS));
    const now = Date.now();
    const maxTriggerAt = now + MAX_LOCAL_WINDOW_MS;
    const label = settings.label || tr("labelPlaceholder");
    const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
    const notifications = [];

    [
      {
        id: `claim:${expiresAt}:early:${earlyDays}`,
        triggerAt: expiresAt - earlyDays * DAY_MS,
        title: getLang() === "ro" ? `Reminder claim: mai ai ${daysLeft} zile` : `Claim reminder: ${daysLeft} days left`,
        titleTemplate: getLang() === "ro" ? "Reminder claim: mai ai {days} zile" : "Claim reminder: {days} days left",
        body: getLang() === "ro"
          ? `${label} expira in curand.`
          : `${label} expires soon.`
      },
      {
        id: `claim:${expiresAt}:final`,
        triggerAt: expiresAt - DAY_MS,
        title: getLang() === "ro" ? "Reminder claim: ultima zi" : "Claim reminder: last day",
        body: getLang() === "ro"
          ? `${label} este in ultima zi.`
          : `${label} is on its final day.`
      }
    ].forEach((item) => {
      if (item.triggerAt < now + 15 * 1000 || item.triggerAt > maxTriggerAt) return;
      notifications.push({
        ...item,
        source: "claim",
        type: "claim-reminder",
        expiresAt,
        url: "index.html#claimReminder",
        tag: `tcl-${item.id}`.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
      });
    });

    return notifications.sort((a, b) => a.triggerAt - b.triggerAt);
  }

  async function postScheduleToServiceWorker(notifications) {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    if (!target) return;
    target.postMessage({
      type: "tcl-claim:schedule",
      notifications
    });
  }

  async function syncLocalSchedule(settings = getSettings()) {
    const notifications = buildLocalSchedule(settings);
    await postScheduleToServiceWorker(notifications).catch((error) => {
      console.warn("Unable to schedule local claim reminders", error);
    });
    return notifications;
  }

  async function clearLocalSchedule() {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: "tcl-claim:clear-schedule" });
  }

  async function showImmediate(title, body, options) {
    const settings = getSettings();
    if (!options?.force && !settings.enabled) return false;
    if (!supportsNotifications() || Notification.permission !== "granted") return false;

    const notificationOptions = {
      body,
      icon: "images/tcl_icon.png",
      badge: "images/tcl_icon.png",
      tag: options?.tag || "tcl-claim-reminder",
      renotify: true,
      data: {
        url: options?.url || "index.html#claimReminder"
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
        console.warn("Claim notification display failed", fallbackError);
        return false;
      }
    }
  }

  async function testReminder() {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (settings.mode === "push" && supportsPush()) {
      try {
        const registration = await getServiceWorkerRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await requestApi("claim/test", {
            method: "POST",
            body: JSON.stringify({
              subscription: getSubscriptionPayload(subscription),
              lang: window.currentLang || getLang(),
              payload: {
                title: tr("testTitle"),
                body: tr("testBody"),
                url: "index.html#claimReminder",
                tag: "tcl-claim-reminder-test"
              }
            })
          });
          return;
        }
      } catch (error) {
        console.warn("Remote claim push test failed; showing local test", error);
      }
    }

    await showImmediate(tr("testTitle"), tr("testBody"), {
      force: true,
      tag: "tcl-claim-reminder-test"
    });
  }

  function formatDate(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return "";
    try {
      return new Intl.DateTimeFormat(navigator.language || "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(Number(timestamp)));
    } catch (_) {
      return new Date(Number(timestamp)).toLocaleString();
    }
  }

  function getNextAlert(settings) {
    const expiresAt = Number(settings.expiresAt);
    if (!settings.enabled || !Number.isFinite(expiresAt)) return null;
    const earlyDays = Math.max(1, Math.round(Number(settings.earlyDays) || DEFAULT_EARLY_DAYS));
    const now = Date.now();
    const alerts = [
      expiresAt - earlyDays * DAY_MS,
      expiresAt - DAY_MS
    ].filter((timestamp, index, list) => timestamp > now && list.indexOf(timestamp) === index)
      .sort((left, right) => left - right);
    return alerts[0] || null;
  }

  function formatEarlyAlert(earlyDays) {
    const days = Math.max(1, Math.round(Number(earlyDays) || DEFAULT_EARLY_DAYS));
    if (getLang() === "ro") return `${days} ${days === 1 ? "zi" : "zile"} inainte`;
    return `${days} ${days === 1 ? "day" : "days"} before`;
  }

  function getReminderStatusVars(settings = getSettings()) {
    return {
      earlyAlert: formatEarlyAlert(settings.earlyDays)
    };
  }

  function setStatusText(statusKey, vars) {
    const status = document.getElementById("claimReminderStatus");
    if (status) status.textContent = tr(statusKey, vars);
  }

  function syncStaticCopy() {
    const pairs = [
      ["claimReminderPageTitle", "pageTitle"],
      ["claimReminderPageIntro", "pageIntro"],
      ["claimReminderPanelTitle", "panelTitle"],
      ["claimReminderLabelText", "labelLabel"],
      ["claimRemainingDaysText", "daysLabel"],
      ["claimEarlyDaysText", "earlyLabel"],
      ["claimEarlyDaysSuffix", "earlySuffix"],
      ["claimReminderSummaryLabel", "summaryLabel"]
    ];

    pairs.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = tr(key);
    });

    const labelInput = document.getElementById("claimReminderLabel");
    if (labelInput) labelInput.setAttribute("placeholder", tr("labelPlaceholder"));

    const saveBtn = document.getElementById("saveClaimReminderBtn");
    const testBtn = document.getElementById("testClaimReminderBtn");
    const disableBtn = document.getElementById("disableClaimReminderBtn");
    if (saveBtn) saveBtn.textContent = tr("save");
    if (testBtn) testBtn.textContent = tr("test");
    if (disableBtn) disableBtn.textContent = tr("disable");
  }

  function syncFormFromSettings(settings = getSettings()) {
    const labelInput = document.getElementById("claimReminderLabel");
    const daysInput = document.getElementById("claimRemainingDays");
    const earlyInput = document.getElementById("claimEarlyDays");

    if (labelInput && !labelInput.value.trim()) labelInput.value = settings.label || tr("labelPlaceholder");
    if (earlyInput && document.activeElement !== earlyInput) {
      earlyInput.value = String(settings.earlyDays || DEFAULT_EARLY_DAYS);
    }
    if (daysInput && settings.enabled && Number.isFinite(Number(settings.expiresAt))) {
      if (document.activeElement !== daysInput) {
        daysInput.value = String(Math.max(1, Math.ceil((Number(settings.expiresAt) - Date.now()) / DAY_MS)));
      }
    }
  }

  function renderSummary() {
    const settings = getSettings();
    const summary = document.getElementById("claimReminderSummary");
    const expires = document.getElementById("claimReminderExpiresAt");
    const next = document.getElementById("claimReminderNextAlert");
    const days = document.getElementById("claimReminderDaysLeft");

    if (!summary || !expires || !next || !days) return;

    const expiresAt = Number(settings.expiresAt);
    if (!settings.enabled || !Number.isFinite(expiresAt)) {
      days.textContent = "--";
      summary.textContent = tr("summaryEmpty");
      expires.textContent = "";
      next.textContent = "";
      return;
    }

    const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
    days.textContent = String(daysLeft);
    summary.textContent = daysLeft > 0 ? tr("summaryActive", { days: daysLeft }) : tr("summaryExpired");
    expires.textContent = tr("expiresAt", { date: formatDate(expiresAt) });

    const nextAlert = getNextAlert(settings);
    next.textContent = nextAlert
      ? tr("nextAlert", { date: formatDate(nextAlert) })
      : tr("noFutureAlert");
  }

  function refreshStatus() {
    const panel = document.getElementById("claimReminderPanel");
    const saveBtn = document.getElementById("saveClaimReminderBtn");
    const testBtn = document.getElementById("testClaimReminderBtn");
    const disableBtn = document.getElementById("disableClaimReminderBtn");
    if (!panel || !saveBtn || !testBtn || !disableBtn) return;

    syncStaticCopy();
    renderSummary();

    const settings = getSettings();
    panel.dataset.state = settings.enabled ? settings.mode : "ready";

    saveBtn.disabled = state.busy;
    testBtn.disabled = state.busy;
    disableBtn.disabled = state.busy;

    if (state.busy) {
      setStatusText("busy");
      return;
    }

    if (!supportsNotifications()) {
      setStatusText("unsupported");
      saveBtn.hidden = true;
      testBtn.hidden = true;
      disableBtn.hidden = true;
      return;
    }

    if (Notification.permission === "denied") {
      setStatusText("denied");
      saveBtn.hidden = true;
      testBtn.hidden = true;
      disableBtn.hidden = !settings.enabled;
      return;
    }

    saveBtn.hidden = false;
    testBtn.hidden = !settings.enabled;
    disableBtn.hidden = !settings.enabled;

    if (settings.enabled) {
      setStatusText(settings.mode === "push" ? "enabledPush" : "enabledLocal", getReminderStatusVars(settings));
      return;
    }

    setStatusText(state.pushServerConfigured === false ? "serverMissing" : "ready");
  }

  function bindControls() {
    document.getElementById("saveClaimReminderBtn")?.addEventListener("click", () => {
      upsertReminder().catch((error) => {
        console.error("Claim reminder save failed", error);
        state.busy = false;
        refreshStatus();
      });
    });

    document.getElementById("testClaimReminderBtn")?.addEventListener("click", () => {
      testReminder().catch((error) => console.error("Claim reminder test failed", error));
    });

    document.getElementById("disableClaimReminderBtn")?.addEventListener("click", () => {
      disableReminder().catch((error) => {
        console.error("Claim reminder disable failed", error);
        state.busy = false;
        refreshStatus();
      });
    });
  }

  async function boot() {
    state.lang = getLang();
    bindControls();
    syncFormFromSettings();
    refreshStatus();
    setClaimReminderCountCard("loading");
    await getPushConfig();
    refreshStatus();
    startClaimReminderStatsPolling();

    if (getSettings().enabled) {
      await syncLocalSchedule(getSettings());
    }

    if (!state.statusTimer) {
      state.statusTimer = window.setInterval(() => {
        renderSummary();
        syncFormFromSettings(getSettings());
      }, STATUS_TICK_MS);
    }
  }

  window.TCLClaimReminder = {
    save: () => upsertReminder(),
    disable: disableReminder,
    refreshStatus,
    refreshClaimReminderStats,
    syncLocalSchedule,
    setLanguage(lang) {
      state.lang = lang || getLang();
      syncStaticCopy();
      renderSummary();
      refreshStatus();
      setClaimReminderCountCard("ready", state.reminderCount);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot().catch(console.error), { once: true });
  } else {
    boot().catch(console.error);
  }
})();
