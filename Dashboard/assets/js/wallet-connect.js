(function () {
  "use strict";

  const XPORTAL = window.TCLXPortal;
  const TCL_MAIN_SC = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";

  const CONFIG = {
    walletConnectProjectId: XPORTAL.CONFIG.projectId,
    relayUrl: XPORTAL.CONFIG.relayUrl,
    chainId: XPORTAL.CONFIG.chainId,
    chainID: XPORTAL.CONFIG.chainID,
    apiBase: MultiversXAPI.API,
    gatewayBase: MultiversXAPI.GATEWAY,
    // Real claimInfinityRewards/claimLendingRewards transactions observed on
    // chain used ~100.18M gas; rounded up for headroom.
    GAS_CLAIM: 100_500_000,
    GAS_PRICE: 1_000_000_000,
    SIGN_TIMEOUT_MS: 60_000,
    TX_CONFIRM_TIMEOUT_MS: 120_000
  };

  const S = { signClient: null, sessionTopic: "", address: "", connecting: false };

  function emitChange() {
    window.dispatchEvent(new CustomEvent("lander:wallet-changed", { detail: { address: S.address } }));
  }

  async function getSignClient() {
    if (S.signClient) return S.signClient;
    S.signClient = await XPORTAL.getClient({
      projectId: CONFIG.walletConnectProjectId,
      relayUrl: CONFIG.relayUrl,
      onSessionDelete: () => {
        S.sessionTopic = "";
        S.address = "";
        emitChange();
      },
      metadata: XPORTAL.createMetadata({
        name: "Lander (local)",
        description: "Local reconstruction of the Lander staking/NFT dashboard",
        fallbackPath: "/Dashboard/dashboard.html",
        iconPath: "../images/tcl_icon.png"
      })
    });
    return S.signClient;
  }

  async function restoreSession() {
    const restored = await XPORTAL.restore({
      projectId: CONFIG.walletConnectProjectId,
      relayUrl: CONFIG.relayUrl
    });
    if (restored) {
      S.signClient = restored.client;
      S.sessionTopic = restored.topic;
      S.address = restored.address;
      emitChange();
    }
    return restored;
  }

  // Starts a WalletConnect pairing and reports the QR/deep-link URI via
  // onUri as soon as it's available, then resolves once the user approves
  // in xPortal.
  async function pair(onUri) {
    if (S.connecting) throw new Error("A connection attempt is already in progress.");
    S.connecting = true;
    try {
      await getSignClient();
      const pairing = await XPORTAL.startPairing({
        projectId: CONFIG.walletConnectProjectId,
        relayUrl: CONFIG.relayUrl
      });
      if (onUri && pairing.uri) onUri(pairing.uri);
      const approved = await XPORTAL.approvePairing(pairing);
      S.sessionTopic = approved.topic;
      S.address = approved.address;
      emitChange();
      return approved;
    } finally {
      S.connecting = false;
    }
  }

  // Drop the in-memory session only (used when another page already ended the shared one).
  function forget() {
    S.sessionTopic = "";
    S.address = "";
    emitChange();
  }

  async function disconnect() {
    await XPORTAL.disconnect({ client: S.signClient, topic: S.sessionTopic });
    S.sessionTopic = "";
    S.address = "";
    emitChange();
  }

  function normalizeTxForSigning(tx) {
    const normalized = {
      ...tx,
      nonce: Number(tx.nonce || 0),
      value: String(tx.value ?? "0"),
      gasPrice: Number(tx.gasPrice),
      gasLimit: Number(tx.gasLimit),
      chainID: String(tx.chainID || CONFIG.chainID),
      version: Number(tx.version || 1)
    };
    if (normalized.data) normalized.data = btoa(normalized.data);
    return normalized;
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function signTx(tx) {
    if (!S.sessionTopic || !S.address) throw new Error("Connect xPortal first.");
    const signing = normalizeTxForSigning(tx);
    const client = await getSignClient();
    const reqPromise = client.request({
      topic: S.sessionTopic,
      chainId: CONFIG.chainId,
      request: { method: "mvx_signTransaction", params: { transaction: signing } }
    });
    if (XPORTAL.isMobile()) XPORTAL.openApp();
    const result = await withTimeout(reqPromise, CONFIG.SIGN_TIMEOUT_MS, "No signature received from xPortal.");
    const signed = result?.transaction && typeof result.transaction === "object"
      ? { ...signing, ...result.transaction }
      : { ...signing, ...result };
    if (!signed.signature) throw new Error("xPortal did not return a signature.");
    return signed;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return data;
  }

  async function broadcastTx(tx) {
    try {
      const d = await postJson(`${CONFIG.apiBase}/transactions`, tx);
      return d.txHash || d.hash || d;
    } catch (_) {
      const d = await postJson(`${CONFIG.gatewayBase}/transaction/send`, tx);
      return d?.data?.txHash || d?.txHash || d?.hash || d;
    }
  }

  async function getOnChainFailureReason(hash) {
    try {
      const res = await fetch(`${CONFIG.apiBase}/transactions/${hash}?withOperations=true`);
      if (!res.ok) return "";
      const tx = await res.json();
      const errorOp = (tx.operations || []).find((op) => op.action === "signalError");
      return errorOp?.message || "";
    } catch (_) {
      return "";
    }
  }

  async function waitForSuccess(hash, timeoutMs = CONFIG.TX_CONFIRM_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "";
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${CONFIG.apiBase}/transactions/${hash}`);
        if (res.ok) {
          const tx = await res.json();
          lastStatus = tx.status;
          if (tx.status === "success") return tx;
          if (tx.status === "fail" || tx.status === "invalid") {
            // Surface the contract's own rejection reason (e.g. "infinity
            // rewards already claimed in this epoch") instead of a generic
            // message — callers use this to correct optimistic UI state
            // that a stale/incomplete claim-history check got wrong.
            const reason = await getOnChainFailureReason(hash);
            const err = new Error(reason ? `Transaction failed on-chain: ${reason}` : "Transaction failed on-chain.");
            err.onChainReason = reason;
            throw err;
          }
        }
      } catch (err) {
        if (/failed on-chain/i.test(err.message)) throw err;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Timed out waiting for confirmation (last status: ${lastStatus || "unknown"}).`);
  }

  // Calls a zero-value TCL_MAIN_SC endpoint that takes the caller's own hex
  // address as its only argument — the exact shape observed on-chain for
  // claimInfinityRewards / claimLendingRewards.
  async function callContract(funcName, extraArgsHex = []) {
    if (!S.address || !S.sessionTopic) throw new Error("Connect xPortal first.");
    const account = await MultiversXAPI.getAccount(S.address);
    const hexAddr = MultiversXAPI.bech32ToHex(S.address);
    const data = [funcName, hexAddr, ...extraArgsHex].join("@");
    const tx = {
      nonce: Number(account.nonce || 0),
      value: "0",
      receiver: TCL_MAIN_SC,
      sender: S.address,
      gasPrice: CONFIG.GAS_PRICE,
      gasLimit: CONFIG.GAS_CLAIM,
      data,
      chainID: CONFIG.chainID,
      version: 1
    };
    const signed = await signTx(tx);
    const hash = await broadcastTx(signed);
    await waitForSuccess(hash);
    return hash;
  }

  window.LanderWallet = {
    CONFIG,
    TCL_MAIN_SC,
    state: S,
    getSignClient,
    restoreSession,
    pair,
    forget,
    disconnect,
    signTx,
    broadcastTx,
    waitForSuccess,
    callContract
  };
})();
