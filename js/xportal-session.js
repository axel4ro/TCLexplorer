(function (global) {
  "use strict";

  const CONFIG = {
    projectId: "3b2862ec02219f2359a7d54b5f0f46ff",
    relayUrl: "wss://relay.walletconnect.com",
    chainId: "mvx:1",
    chainID: "1",
    storageKey: "tclExplorer.xportal.address.v1",
    sessionTopicKey: "tclExplorer.xportal.sessionTopic.v1",
    legacyStorageKeys: [
      {
        addressKey: "tclSwap.xportal.address.v1",
        topicKey: "tclSwap.xportal.sessionTopic.v1"
      }
    ],
    methods: [
      "mvx_signTransaction",
      "mvx_signTransactions",
      "mvx_signMessage",
      "mvx_signLoginToken",
      "mvx_signNativeAuthToken",
      "mvx_cancelAction"
    ],
    requiredMethods: [
      "mvx_signTransaction",
      "mvx_signMessage",
      "mvx_signLoginToken"
    ],
    sessionEventName: "tcl:xportal-session"
  };

  const runtime = {
    client: null,
    projectId: "",
    sessionDeleteHandlers: new Set()
  };

  function getWalletConnectGlobal() {
    const walletConnect = global["@walletconnect/sign-client"];
    return walletConnect?.SignClient || walletConnect?.default || null;
  }

  function isAddress(value) {
    return /^erd1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(String(value || "").trim());
  }

  function truncateAddress(address, head = 10, tail = 8) {
    const value = String(address || "");
    return value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
  }

  function isLocalFile() {
    return !global.location?.origin || global.location.origin === "null";
  }

  function createMetadata(options = {}) {
    const fallbackPath = options.fallbackPath || "/connect_xportal.html";
    const baseUrl = isLocalFile() ? "https://tclexplorer.com" : global.location.origin;
    const pagePath = isLocalFile() ? fallbackPath : (global.location.pathname || fallbackPath);
    const appUrl = new URL(pagePath, baseUrl).href;
    const iconPath = options.iconPath || "images/tcl_icon.png";
    const metadata = {
      name: options.name || "TCL Explorer",
      description: options.description || "TCL Explorer xPortal connection",
      url: appUrl,
      icons: [new URL(iconPath, appUrl).href]
    };

    if (options.redirect !== false) {
      metadata.redirect = { native: "", universal: appUrl };
    }

    return metadata;
  }

  function addSessionDeleteHandler(handler) {
    if (typeof handler === "function") runtime.sessionDeleteHandlers.add(handler);
  }

  function notifySessionChange(detail) {
    try {
      global.dispatchEvent(new CustomEvent(CONFIG.sessionEventName, { detail }));
    } catch (_) {}
  }

  function emitSessionDelete() {
    clearStoredSession({ silent: true });
    runtime.sessionDeleteHandlers.forEach((handler) => {
      try { handler(); } catch (error) { console.warn("xPortal session handler failed", error); }
    });
    notifySessionChange({ type: "deleted" });
  }

  async function getClient(options = {}) {
    const projectId = String(options.projectId || CONFIG.projectId || "").trim();
    if (!projectId) throw new Error("WalletConnect connection is not configured.");

    addSessionDeleteHandler(options.onSessionDelete);

    if (runtime.client && runtime.projectId === projectId) {
      return runtime.client;
    }

    const SignClient = getWalletConnectGlobal();
    if (!SignClient?.init) {
      throw new Error("WalletConnect did not load. Check your internet connection.");
    }

    runtime.client = await SignClient.init({
      projectId,
      relayUrl: options.relayUrl || CONFIG.relayUrl,
      metadata: options.metadata || createMetadata(options)
    });
    runtime.projectId = projectId;
    runtime.client.on("session_delete", emitSessionDelete);
    runtime.client.on("session_expire", emitSessionDelete);
    return runtime.client;
  }

  function getStoredSession() {
    const address = global.localStorage.getItem(CONFIG.storageKey) || "";
    const topic = global.localStorage.getItem(CONFIG.sessionTopicKey) || "";
    if (isAddress(address) && topic) return { address, topic };

    for (const keys of CONFIG.legacyStorageKeys) {
      const legacyAddress = global.localStorage.getItem(keys.addressKey) || "";
      const legacyTopic = global.localStorage.getItem(keys.topicKey) || "";
      if (isAddress(legacyAddress) && legacyTopic) {
        saveSession(legacyAddress, legacyTopic);
        return { address: legacyAddress, topic: legacyTopic };
      }
    }

    return { address: "", topic: "" };
  }

  function saveSession(address, topic) {
    if (!isAddress(address) || !topic) return false;
    global.localStorage.setItem(CONFIG.storageKey, address);
    global.localStorage.setItem(CONFIG.sessionTopicKey, topic);
    notifySessionChange({ type: "saved", address, topic });
    return true;
  }

  function clearStoredSession(options = {}) {
    global.localStorage.removeItem(CONFIG.storageKey);
    global.localStorage.removeItem(CONFIG.sessionTopicKey);
    CONFIG.legacyStorageKeys.forEach((keys) => {
      global.localStorage.removeItem(keys.addressKey);
      global.localStorage.removeItem(keys.topicKey);
    });
    if (!options.silent) notifySessionChange({ type: "cleared" });
  }

  function getSessionMethods(session) {
    const namespaces = session?.namespaces || {};
    return new Set(Object.values(namespaces).flatMap((namespace) => namespace?.methods || []));
  }

  function hasRequiredMethods(session, methods = CONFIG.methods) {
    const granted = getSessionMethods(session);
    const required = CONFIG.requiredMethods.filter((method) => methods.includes(method));
    return required.every((method) => granted.has(method));
  }

  function extractAddress(session) {
    const namespaces = session?.namespaces || {};
    const accounts = Object.values(namespaces).flatMap((namespace) => namespace?.accounts || []);
    const mvxAccount = accounts.find((account) => String(account).startsWith(`${CONFIG.chainId}:`)) ||
      accounts.find((account) => String(account).includes(":erd1"));
    const address = String(mvxAccount || "").split(":").pop();
    return isAddress(address) ? address : "";
  }

  async function restore(options = {}) {
    const stored = getStoredSession();
    if (!isAddress(stored.address) || !stored.topic) return null;

    try {
      const client = await getClient(options);
      const session = client.session.get(stored.topic);
      if (!hasRequiredMethods(session, options.methods || CONFIG.methods)) {
        clearStoredSession();
        return null;
      }

      const sessionAddress = extractAddress(session) || stored.address;
      if (!isAddress(sessionAddress)) {
        clearStoredSession();
        return null;
      }

      saveSession(sessionAddress, stored.topic);
      return { client, session, address: sessionAddress, topic: stored.topic };
    } catch (_) {
      clearStoredSession();
      return null;
    }
  }

  async function startPairing(options = {}) {
    const client = await getClient(options);
    const methods = options.methods || CONFIG.methods;
    const pairing = await client.connect({
      optionalNamespaces: {
        mvx: {
          chains: [CONFIG.chainId],
          methods,
          events: []
        }
      }
    });
    return { client, methods, ...pairing };
  }

  async function approvePairing(pairing, options = {}) {
    const session = await pairing.approval();
    const methods = options.methods || pairing.methods || CONFIG.methods;
    if (!hasRequiredMethods(session, methods)) {
      throw new Error("xPortal did not grant all required permissions. Reconnect xPortal and try again.");
    }

    const address = extractAddress(session);
    if (!address) throw new Error("xPortal did not return a valid MultiversX address.");

    const topic = session.topic || "";
    saveSession(address, topic);
    return { session, address, topic };
  }

  async function disconnect(options = {}) {
    const stored = getStoredSession();
    const topic = options.topic || stored.topic;
    const client = options.client || runtime.client;
    if (client && topic) {
      await client.disconnect({
        topic,
        reason: { code: 6000, message: "User disconnected" }
      }).catch(() => {});
    }
    clearStoredSession();
  }

  function resetClient() {
    runtime.client = null;
    runtime.projectId = "";
  }

  function isIOS() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  function getDeepLink(uri) {
    if (isIOS()) return `xportal://wc?uri=${encodeURIComponent(uri)}`;
    if (isAndroid()) return uri;
    return isMobile() ? uri : "https://xportal.com/app";
  }

  function openApp() {
    if (!isMobile()) return;
    try { global.location.href = "xportal://"; } catch (_) {}
  }

  function renderQr(target, text, size = 220, loaderId = "") {
    if (!global.QRCode) throw new Error("The QR library did not load.");
    target.innerHTML = "";
    if (loaderId) {
      const loader = document.getElementById(loaderId);
      if (loader) loader.remove();
    }
    new global.QRCode(target, {
      text,
      width: size,
      height: size,
      colorDark: "#020408",
      colorLight: "#ffffff",
      correctLevel: global.QRCode.CorrectLevel.M
    });
  }

  global.TCLXPortal = {
    CONFIG,
    addSessionDeleteHandler,
    approvePairing,
    clearStoredSession,
    createMetadata,
    disconnect,
    extractAddress,
    getClient,
    getDeepLink,
    getStoredSession,
    getWalletConnectGlobal,
    hasRequiredMethods,
    isAddress,
    isMobile,
    openApp,
    renderQr,
    resetClient,
    restore,
    saveSession,
    startPairing,
    truncateAddress
  };
})(window);
