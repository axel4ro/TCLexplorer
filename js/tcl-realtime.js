(function () {
  "use strict";

  const CONFIG = {
    pairAddress: "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
    baseTokenAddress: "TCL-fe459d",
    quoteTokenAddress: "USDC-c76f1f",
    transferUrlBase: "https://api.multiversx.com/accounts/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff/transfers",
    dexPairUrl: "https://api.dexscreener.com/latest/dex/pairs/multiversx/erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
    tokenUrl: "https://api.multiversx.com/tokens/TCL-fe459d",
    pollMs: 15 * 1000,
    hiddenPollMs: 45 * 1000,
    settleRefreshMs: 10 * 1000,
    requestTimeoutMs: 8 * 1000
  };

  const EVENTS = {
    ready: "tcl:realtime-ready",
    transaction: "tcl:transaction-detected",
    refresh: "tcl:market-refresh-requested",
    status: "tcl:realtime-status"
  };
  const STORAGE_KEY = "tclRealtime.latestPairTransfer.v1";
  const CHANNEL_NAME = "tcl-realtime";
  const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  let channel = null;
  let started = false;
  let timer = null;
  let inFlight = false;
  let bootstrapped = false;
  let lastRefreshKey = null;
  let settleTimer = null;

  const state = {
    latestKey: null,
    latestTransfer: null,
    lastCheckedAt: 0,
    lastDetectedAt: 0,
    lastError: null,
    online: true
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, {
      detail: {
        ...detail,
        realtime: true,
        pageId: PAGE_ID
      }
    }));
  }

  function toSafeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return "";
    }
  }

  function readStoredLatest() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeStoredLatest(payload) {
    try {
      window.localStorage.setItem(STORAGE_KEY, toSafeJson(payload));
    } catch (_) {}
  }

  function buildUrl(url, params = {}) {
    const resolved = new URL(url, window.location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        resolved.searchParams.set(key, String(value));
      }
    });
    resolved.searchParams.set("_rt", String(Date.now()));
    return resolved.toString();
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(options.headers || {})
        },
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getTransferKey(transfer) {
    if (!transfer || typeof transfer !== "object") return null;

    const hash = String(
      transfer.originalTxHash ||
      transfer.txHash ||
      transfer.hash ||
      ""
    ).trim();
    const timestamp = Number(transfer.timestamp) || 0;
    const nonce = Number(transfer.nonce) || "";

    if (!hash && !timestamp) return null;
    return `${hash || "transfer"}:${timestamp}:${nonce}`;
  }

  function normalizeTransfer(transfer) {
    if (!transfer || typeof transfer !== "object") return null;

    return {
      key: getTransferKey(transfer),
      txHash: String(transfer.originalTxHash || transfer.txHash || transfer.hash || ""),
      timestamp: Number(transfer.timestamp) || 0,
      sender: String(transfer.sender || ""),
      receiver: String(transfer.receiver || ""),
      functionName: String(transfer.function || ""),
      status: String(transfer.status || ""),
      description: String(transfer.action?.description || "")
    };
  }

  async function fetchLatestTransfer() {
    const url = buildUrl(CONFIG.transferUrlBase, {
      size: 1,
      status: "success",
      order: "desc"
    });
    const payload = await fetchJson(url);
    return Array.isArray(payload) && payload.length ? payload[0] : null;
  }

  function scheduleNextCheck(delayMs) {
    if (!started) return;
    window.clearTimeout(timer);

    const resolvedDelay = Number.isFinite(delayMs)
      ? delayMs
      : (document.hidden ? CONFIG.hiddenPollMs : CONFIG.pollMs);

    timer = window.setTimeout(checkLatestTransfer, resolvedDelay);
  }

  function broadcast(payload) {
    if (channel) {
      try {
        channel.postMessage(payload);
      } catch (_) {}
    }
  }

  function dispatchRefreshRequest(detail, phase) {
    const refreshKey = `${detail.key}:${phase}`;
    if (lastRefreshKey === refreshKey) return;
    lastRefreshKey = refreshKey;

    emit(EVENTS.refresh, {
      ...detail,
      phase
    });
  }

  function publishTransaction(transfer, source = "poll") {
    const normalized = normalizeTransfer(transfer);
    if (!normalized?.key || normalized.key === state.latestKey && source === "remote") {
      return;
    }

    state.latestKey = normalized.key;
    state.latestTransfer = normalized;
    state.lastDetectedAt = Date.now();
    state.lastError = null;
    state.online = true;

    const detail = {
      key: normalized.key,
      transfer: normalized,
      detectedAt: state.lastDetectedAt,
      source
    };

    writeStoredLatest(detail);
    broadcast({ type: "transaction", detail });
    emit(EVENTS.transaction, detail);
    dispatchRefreshRequest(detail, "instant");

    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      dispatchRefreshRequest(detail, "settled");
    }, CONFIG.settleRefreshMs);
  }

  async function checkLatestTransfer() {
    if (inFlight) {
      scheduleNextCheck(CONFIG.pollMs);
      return;
    }

    inFlight = true;
    emit(EVENTS.status, { status: "checking" });

    try {
      const transfer = await fetchLatestTransfer();
      const normalized = normalizeTransfer(transfer);
      const currentKey = normalized?.key || null;
      const stored = readStoredLatest();
      const previousKey = state.latestKey || stored?.key || null;

      state.lastCheckedAt = Date.now();
      state.lastError = null;
      state.online = true;

      if (currentKey) {
        state.latestKey = currentKey;
        state.latestTransfer = normalized;

        if (!bootstrapped) {
          bootstrapped = true;
          if (previousKey && previousKey !== currentKey) {
            publishTransaction(transfer, "startup");
          } else if (!previousKey) {
            writeStoredLatest({
              key: currentKey,
              transfer: normalized,
              detectedAt: state.lastCheckedAt,
              source: "startup"
            });
          }
          emit(EVENTS.ready, { state: getState() });
        } else if (previousKey && previousKey !== currentKey) {
          publishTransaction(transfer, "poll");
        }
      }

      emit(EVENTS.status, { status: "watching", state: getState() });
    } catch (error) {
      state.lastCheckedAt = Date.now();
      state.lastError = error?.message || "Realtime watcher failed";
      state.online = false;
      emit(EVENTS.status, { status: "error", error: state.lastError, state: getState() });
    } finally {
      inFlight = false;
      scheduleNextCheck();
    }
  }

  function handleRemoteMessage(detail) {
    if (!detail?.key || detail.pageId === PAGE_ID) return;
    if (detail.key === state.latestKey) return;

    state.latestKey = detail.key;
    state.latestTransfer = detail.transfer || null;
    state.lastDetectedAt = detail.detectedAt || Date.now();
    state.online = true;
    emit(EVENTS.transaction, { ...detail, source: detail.source || "remote" });
    dispatchRefreshRequest(detail, "instant");

    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      dispatchRefreshRequest(detail, "settled");
    }, CONFIG.settleRefreshMs);
  }

  function getState() {
    return {
      ...state,
      config: { ...CONFIG },
      started,
      inFlight
    };
  }

  function on(name, callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (event) => callback(event.detail, event);
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }

  function start() {
    if (started) return;
    started = true;

    if ("BroadcastChannel" in window && !channel) {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.addEventListener("message", (event) => {
          if (event?.data?.type === "transaction") {
            handleRemoteMessage(event.data.detail);
          }
        });
      } catch (_) {
        channel = null;
      }
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        handleRemoteMessage(JSON.parse(event.newValue));
      } catch (_) {}
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        checkLatestTransfer();
      }
    });

    checkLatestTransfer();
  }

  function stop() {
    started = false;
    window.clearTimeout(timer);
    window.clearTimeout(settleTimer);
  }

  window.TCLRealtime = {
    config: CONFIG,
    events: EVENTS,
    start,
    stop,
    refreshNow: checkLatestTransfer,
    getState,
    fetchJson,
    buildUrl,
    onTransaction(callback) {
      return on(EVENTS.transaction, callback);
    },
    onRefresh(callback) {
      return on(EVENTS.refresh, callback);
    },
    onStatus(callback) {
      return on(EVENTS.status, callback);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
