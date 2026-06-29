/**
 * Server-side PNL swap computation.
 * The parsing functions below are ported VERBATIM from pnlCheck.html so results
 * match the client EXACTLY. Runs against the local Postgres (no large data
 * transfer) and returns just the swap totals — see /api/pnl/:wallet in server.js.
 */

const CONFIG = {
  listingDate: "2024-06-13T00:00:00Z",
  pnlPairAddress: "erd1qqqqqqqqqqqqqpgq6quepqlx66rmwst8uxl6p28jhcrnva982jpszqhxff",
  pnlGameContract: "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk",
  pnlAggregatorAddresses: [
    "erd1qqqqqqqqqqqqqpgqcc69ts8409p3h77q5chsaqz57y6hugvc4fvs64k74v",
    "erd1qqqqqqqqqqqqqpgq5rf2sppxk2xu4m0pkmugw2es4gak3rgjah0sxvajva",
    "erd1qqqqqqqqqqqqqpgqn7wy983tdh5katf5yn5nl2gcdflf4azh6jtsggjx9a",
    "erd1qqqqqqqqqqqqqpgqq66xk9gfr4esuhem3jru86wg5hvp33a62jps2fy57p",
    "erd1qqqqqqqqqqqqqpgqsytkvnexypp7argk02l0rasnj57sxa542jpshkl7df"
  ],
  pnlAggregatorBuyMinTcl: 0.001,
  pnlAggregatorBuyRootLimit: 180,
  pnlSwapFunctions: [
    "swapTokensFixedInput","swapTokensFixedOutput","multiPairSwap",
    "multiPairSwapTokensFixedInput","swap","aggregateEsdt","aggregateEgld",
    "xo","buySwap","composeTasks"
  ],
  tokens: {
    egld: { symbol: "EGLD", decimals: 18 },
    usdc: { symbol: "USDC", identifier: "USDC-c76f1f", decimals: 6 },
    tcl:  { symbol: "TCL",  identifier: "TCL-fe459d",  decimals: 18 }
  }
};

function supabaseRowToPnlEntry(row) {
  return {
    txHash:         row.tx_hash,
    originalTxHash: row.original_tx_hash || undefined,
    type:           row.type || undefined,
    sender:         row.sender,
    receiver:       row.receiver,
    timestamp:      row.ts,
    function:       row.function || undefined,
    status:         row.status || "success",
    action:         row.action_transfers ? { arguments: { transfers: row.action_transfers } } : undefined,
    operations:     row.operations || undefined
  };
}

// ── parsing functions (verbatim from pnlCheck.html) ───────────────────────────
      function readNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      }

      function rawToNumber(raw, decimals) {
        const clean = String(raw || "0").replace(/[^\d]/g, "");
        if (!clean) return 0;
        if (!decimals) return Number(clean);
        const padded = clean.padStart(decimals + 1, "0");
        const whole = padded.slice(0, -decimals);
        const fraction = padded.slice(-decimals);
        return Number(`${whole}.${fraction}`);
      }

      function decimalStringToNumber(value, decimals) {
        const raw = String(value || "").replace(/[^\d]/g, "");
        if (!raw) return Number.NaN;
        const precision = Math.max(0, Number(decimals) || 0);
        if (!precision) return Number(raw);
        const padded = raw.padStart(precision + 1, "0");
        const whole = padded.slice(0, -precision);
        const fraction = padded.slice(-precision);
        const amount = Number(`${whole}.${fraction}`);
        return Number.isFinite(amount) ? amount : Number.NaN;
      }

      function normalizePnlTradeTransfer(transfer) {
        const token = transfer?.token || transfer?.identifier || "";
        if (!token || !transfer?.value) return null;
        const decimals = Number(transfer.decimals ?? (
          token === CONFIG.tokens.usdc.identifier
            ? CONFIG.tokens.usdc.decimals
            : CONFIG.tokens.tcl.decimals
        ));
        const amount = decimalStringToNumber(transfer.value, decimals);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return { token, amount };
      }

      function normalizePnlOperation(operation) {
        if (operation?.action && operation.action !== "transfer") return null;
        const token = operation?.identifier || operation?.token || (operation?.type === "egld" ? "EGLD" : "");
        if (!token || !operation?.value) return null;
        if (operation?.esdtType && operation.esdtType !== "FungibleESDT") return null;
        const decimals = Number(operation.decimals ?? (
          token === CONFIG.tokens.usdc.identifier
            ? CONFIG.tokens.usdc.decimals
            : (token === "EGLD" ? CONFIG.tokens.egld.decimals : CONFIG.tokens.tcl.decimals)
        ));
        const amount = decimalStringToNumber(operation.value, decimals);
        if (!Number.isFinite(amount) || amount <= 0) return null;

        const valueUsd = token === CONFIG.tokens.usdc.identifier
          ? amount
          : readNumber(operation.valueUSD, Number.NaN);

        return {
          token,
          amount,
          valueUsd,
          sender: operation.sender || "",
          receiver: operation.receiver || "",
          key: [
            operation.id || "",
            operation.action || "",
            operation.type || "",
            token,
            operation.sender || "",
            operation.receiver || "",
            String(operation.value || "")
          ].join("|")
        };
      }

      function getPnlRootHash(entry) {
        return String(entry?.originalTxHash || entry?.txHash || "");
      }

      function groupPnlTransfers(transfers) {
        const groups = new Map();

        for (const entry of Array.isArray(transfers) ? transfers : []) {
          if (entry?.status !== "success") continue;
          const rootHash = getPnlRootHash(entry);
          if (!rootHash) continue;

          let group = groups.get(rootHash);
          const timestamp = Number(entry.timestamp) || 0;
          if (!group) {
            group = {
              hash: rootHash,
              timestamp,
              entries: []
            };
            groups.set(rootHash, group);
          } else if (timestamp && (!group.timestamp || timestamp < group.timestamp)) {
            group.timestamp = timestamp;
          }

          group.entries.push(entry);
        }

        return groups;
      }

      function parsePnlTradesFromOperations(transfers, walletAddress) {
        const trades = [];
        const transferGroups = groupPnlTransfers(transfers);

        for (const group of transferGroups.values()) {
          const seenOperations = new Set();
          const operations = [];

          for (const entry of group.entries) {
            if (!Array.isArray(entry.operations)) continue;

            for (const rawOperation of entry.operations) {
              const operation = normalizePnlOperation(rawOperation);
              if (!operation || seenOperations.has(operation.key)) continue;
              seenOperations.add(operation.key);
              operations.push(operation);
            }
          }

          if (!operations.length) continue;

          const tclSent = operations
            .filter((operation) => operation.token === CONFIG.tokens.tcl.identifier && operation.sender === walletAddress)
            .reduce((sum, operation) => sum + operation.amount, 0);
          const tclReceived = operations
            .filter((operation) => operation.token === CONFIG.tokens.tcl.identifier && operation.receiver === walletAddress)
            .reduce((sum, operation) => sum + operation.amount, 0);
          const usdSent = operations
            .filter((operation) => operation.token !== CONFIG.tokens.tcl.identifier && operation.sender === walletAddress && Number.isFinite(operation.valueUsd))
            .reduce((sum, operation) => sum + operation.valueUsd, 0);
          const usdReceived = operations
            .filter((operation) => operation.token !== CONFIG.tokens.tcl.identifier && operation.receiver === walletAddress && Number.isFinite(operation.valueUsd))
            .reduce((sum, operation) => sum + operation.valueUsd, 0);
          const tclSentUsd = operations
            .filter((operation) => operation.token === CONFIG.tokens.tcl.identifier && operation.sender === walletAddress && Number.isFinite(operation.valueUsd))
            .reduce((sum, operation) => sum + operation.valueUsd, 0);
          const tclReceivedUsd = operations
            .filter((operation) => operation.token === CONFIG.tokens.tcl.identifier && operation.receiver === walletAddress && Number.isFinite(operation.valueUsd))
            .reduce((sum, operation) => sum + operation.valueUsd, 0);
          const hasNonTclSent = operations
            .some((operation) => operation.token !== CONFIG.tokens.tcl.identifier && operation.sender === walletAddress);
          const hasNonTclReceived = operations
            .some((operation) => operation.token !== CONFIG.tokens.tcl.identifier && operation.receiver === walletAddress);
          const pairInvolved = group.entries
            .some((entry) => entry.sender === CONFIG.pnlPairAddress || entry.receiver === CONFIG.pnlPairAddress)
            || operations.some((operation) => operation.sender === CONFIG.pnlPairAddress || operation.receiver === CONFIG.pnlPairAddress);
          const groupFunctions = group.entries
            .map((entry) => String(entry?.function || entry?.action?.name || ""))
            .filter(Boolean);
          const hasKnownSwapFunction = groupFunctions
            .some((name) => CONFIG.pnlSwapFunctions.includes(name) || /^swap/i.test(name));

          let side = "";
          let tclAmount = 0;
          let volumeUsd = 0;
          const netTcl = tclReceived - tclSent;
          const netUsd = usdReceived - usdSent;
          // Fallback relaxat: orice protocol DEX (xo, aggregateEsdt, etc.)
          // inclusiv cand plata nu e vizibila in operatii (routing indirect, xo protocol)
          const buyFallbackUsd  = hasKnownSwapFunction && tclReceivedUsd > 0 ? tclReceivedUsd : 0;
          const sellFallbackUsd = hasKnownSwapFunction && tclSentUsd > 0 ? tclSentUsd : 0;

          if (netTcl > 0 && netUsd < 0) {
            side = "buy";
            tclAmount = netTcl;
            volumeUsd = Math.abs(netUsd);
          } else if (netTcl < 0 && netUsd > 0) {
            side = "sell";
            tclAmount = Math.abs(netTcl);
            volumeUsd = netUsd;
          } else if (netTcl > 0 && buyFallbackUsd > 0) {
            side = "buy";
            tclAmount = netTcl;
            volumeUsd = buyFallbackUsd;
          } else if (netTcl < 0 && sellFallbackUsd > 0) {
            side = "sell";
            tclAmount = Math.abs(netTcl);
            volumeUsd = sellFallbackUsd;
          } else if (tclReceived > 0 && usdSent > 0) {
            side = "buy";
            tclAmount = tclReceived;
            volumeUsd = usdSent;
          } else if (tclSent > 0 && usdReceived > 0) {
            side = "sell";
            tclAmount = tclSent;
            volumeUsd = usdReceived;
          }

          if (!side || !Number.isFinite(tclAmount) || tclAmount <= 0 || !Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;
          trades.push({
            hash: group.hash,
            timestamp: group.timestamp,
            side,
            tclAmount,
            volumeUsd,
            price: volumeUsd / tclAmount,
            description: "Swap TCL"
          });
        }

        return trades;
      }

      function parsePnlTradesFromPairTransfers(transfers, walletAddress) {
        const groupedSwaps = new Map();

        for (const entry of Array.isArray(transfers) ? transfers : []) {
          if (entry?.status !== "success") continue;

          const transferList = entry?.action?.arguments?.transfers;
          if (!Array.isArray(transferList) || !transferList.length) continue;

          const primaryTransfer = normalizePnlTradeTransfer(transferList[0]);
          if (!primaryTransfer) continue;

          const timestamp = Number(entry.timestamp);
          if (!Number.isFinite(timestamp)) continue;

          const groupHash = getPnlRootHash(entry);
          if (!groupHash) continue;

          let groupedSwap = groupedSwaps.get(groupHash);
          if (!groupedSwap) {
            groupedSwap = {
              hash: groupHash,
              timestamp,
              inputToken: null,
              inputAmount: 0,
              outputToken: null,
              outputAmount: 0,
              // Output stocat inline in action_transfers al tranzactiei swap (fara SCR
              // separat pair->wallet). Folosit doar daca operations lipseste si nu
              // exista un output SCR — evita dublarea pe swap-urile deja enrichuite.
              inlineOutputToken: null,
              inlineOutputAmount: 0,
              description: "",
              invalid: false
            };
            groupedSwaps.set(groupHash, groupedSwap);
          } else if (timestamp < groupedSwap.timestamp) {
            groupedSwap.timestamp = timestamp;
          }

          const description = String(entry?.action?.description || "");
          if (description && (!groupedSwap.description || groupedSwap.description === "Transfer" || description !== "Transfer")) {
            groupedSwap.description = description;
          }

          const isSwapInput =
            entry.sender === walletAddress &&
            entry.receiver === CONFIG.pnlPairAddress &&
            (/^swap/i.test(String(entry.function || "")) || entry?.action?.name === "swap");

          if (isSwapInput) {
            if (groupedSwap.inputToken && groupedSwap.inputToken !== primaryTransfer.token) {
              groupedSwap.invalid = true;
              continue;
            }
            groupedSwap.inputToken = primaryTransfer.token;
            groupedSwap.inputAmount += primaryTransfer.amount;
            // Unele swap-uri (cele cu operations=null, neenrichuite) au output-ul
            // (TCL/USDC primit) inline in action_transfers, nu intr-un SCR pair->wallet.
            for (let i = 1; i < transferList.length; i += 1) {
              const extra = normalizePnlTradeTransfer(transferList[i]);
              if (!extra || extra.token === primaryTransfer.token) continue;
              if (extra.token !== CONFIG.tokens.tcl.identifier && extra.token !== CONFIG.tokens.usdc.identifier) continue;
              if (groupedSwap.inlineOutputToken && groupedSwap.inlineOutputToken !== extra.token) continue;
              groupedSwap.inlineOutputToken = extra.token;
              groupedSwap.inlineOutputAmount += extra.amount;
            }
            continue;
          }

          const isPairOutput =
            entry.sender === CONFIG.pnlPairAddress &&
            entry.receiver === walletAddress &&
            entry.function !== "depositSwapFees" &&
            (primaryTransfer.token === CONFIG.tokens.tcl.identifier || primaryTransfer.token === CONFIG.tokens.usdc.identifier);

          if (!isPairOutput) continue;

          if (groupedSwap.outputToken && groupedSwap.outputToken !== primaryTransfer.token) {
            groupedSwap.invalid = true;
            continue;
          }

          groupedSwap.outputToken = primaryTransfer.token;
          groupedSwap.outputAmount += primaryTransfer.amount;
        }

        const trades = [];
        for (const groupedSwap of groupedSwaps.values()) {
          if (groupedSwap.invalid) continue;
          // Fallback: daca nu am gasit un output SCR pair->wallet, foloseste output-ul
          // inline din tranzactia swap (cazul operations=null, swap neenrichuit).
          if ((!groupedSwap.outputToken || groupedSwap.outputAmount <= 0) && groupedSwap.inlineOutputToken && groupedSwap.inlineOutputAmount > 0) {
            groupedSwap.outputToken = groupedSwap.inlineOutputToken;
            groupedSwap.outputAmount = groupedSwap.inlineOutputAmount;
          }
          if (!groupedSwap.inputToken || !groupedSwap.outputToken || groupedSwap.inputAmount <= 0 || groupedSwap.outputAmount <= 0) continue;

          let side = "";
          let tclAmount = 0;
          let volumeUsd = 0;

          if (groupedSwap.inputToken === CONFIG.tokens.usdc.identifier && groupedSwap.outputToken === CONFIG.tokens.tcl.identifier) {
            side = "buy";
            tclAmount = groupedSwap.outputAmount;
            volumeUsd = groupedSwap.inputAmount;
          } else if (groupedSwap.inputToken === CONFIG.tokens.tcl.identifier && groupedSwap.outputToken === CONFIG.tokens.usdc.identifier) {
            side = "sell";
            tclAmount = groupedSwap.inputAmount;
            volumeUsd = groupedSwap.outputAmount;
          } else {
            continue;
          }

          const price = volumeUsd / tclAmount;
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;

          trades.push({
            hash: groupedSwap.hash,
            timestamp: groupedSwap.timestamp,
            side,
            tclAmount,
            volumeUsd,
            price,
            description: groupedSwap.description
          });
        }

        return trades.sort((left, right) => left.timestamp - right.timestamp);
      }

      function parsePnlTrades(transfers, walletAddress) {
        const operationTrades = parsePnlTradesFromOperations(transfers, walletAddress);
        const fallbackTrades = parsePnlTradesFromPairTransfers(transfers, walletAddress);
        const merged = new Map();

        fallbackTrades.forEach((trade) => {
          merged.set(trade.hash, trade);
        });
        operationTrades.forEach((trade) => {
          merged.set(trade.hash, trade);
        });

        return Array.from(merged.values()).sort((left, right) => left.timestamp - right.timestamp);
      }

      function sumPnlEntryTokenAmount(entry, tokenId) {
        const transferList = entry?.action?.arguments?.transfers;
        if (!Array.isArray(transferList)) return 0;
        return transferList.reduce((sum, transfer) => {
          const normalized = normalizePnlTradeTransfer(transfer);
          return normalized?.token === tokenId ? sum + normalized.amount : sum;
        }, 0);
      }

      function getPnlAggregatorSet() {
        return new Set((CONFIG.pnlAggregatorAddresses || []).map((address) => String(address).trim()).filter(Boolean));
      }

      function parseAggregatorBuyTradeFromRoot(rootTx, candidate, walletAddress) {
        if (!rootTx || (rootTx.status && rootTx.status !== "success")) return null;

        const aggregators = getPnlAggregatorSet();
        if (rootTx.sender !== walletAddress || !aggregators.has(rootTx.receiver)) return null;

        const operations = Array.isArray(rootTx.operations)
          ? rootTx.operations.map(normalizePnlOperation).filter(Boolean)
          : [];
        if (!operations.length) return null;

        const tclToWallet = operations
          .filter((operation) =>
            operation.token === CONFIG.tokens.tcl.identifier &&
            operation.receiver === walletAddress &&
            aggregators.has(operation.sender)
          )
          .reduce((sum, operation) => sum + operation.amount, 0);
        const tclAmount = tclToWallet > 0 ? tclToWallet : candidate.tclAmount;
        if (!Number.isFinite(tclAmount) || tclAmount <= readNumber(CONFIG.pnlAggregatorBuyMinTcl, 0)) return null;

        const usdcIntoPair = operations
          .filter((operation) =>
            operation.token === CONFIG.tokens.usdc.identifier &&
            operation.receiver === CONFIG.pnlPairAddress
          )
          .reduce((sum, operation) => sum + operation.amount, 0);
        if (!Number.isFinite(usdcIntoPair) || usdcIntoPair <= 0) return null;

        const tclIntoPair = operations
          .filter((operation) =>
            operation.token === CONFIG.tokens.tcl.identifier &&
            operation.receiver === CONFIG.pnlPairAddress
          )
          .reduce((sum, operation) => sum + operation.amount, 0);
        if (tclIntoPair > tclAmount) return null;

        return {
          hash: candidate.hash,
          timestamp: candidate.timestamp || Number(rootTx.timestamp) || 0,
          side: "buy",
          tclAmount,
          volumeUsd: usdcIntoPair,
          price: usdcIntoPair / tclAmount,
          description: "Aggregator TCL buy"
        };
      }

      function collectAggregatorBuyCandidates(transfers, walletAddress, knownTradeHashes = new Set()) {
        const aggregators = getPnlAggregatorSet();
        if (!aggregators.size) return [];

        const minTcl = Math.max(0, readNumber(CONFIG.pnlAggregatorBuyMinTcl, 0));
        const candidates = new Map();

        for (const entry of Array.isArray(transfers) ? transfers : []) {
          if (entry?.status !== "success") continue;
          if (entry.receiver !== walletAddress || !aggregators.has(entry.sender)) continue;

          const rootHash = getPnlRootHash(entry);
          if (!/^[0-9a-f]{64}$/i.test(rootHash) || knownTradeHashes.has(rootHash)) continue;

          const tclAmount = sumPnlEntryTokenAmount(entry, CONFIG.tokens.tcl.identifier);
          if (!Number.isFinite(tclAmount) || tclAmount <= minTcl) continue;

          const timestamp = Number(entry.timestamp) || 0;
          const existing = candidates.get(rootHash);
          if (existing) {
            existing.tclAmount += tclAmount;
            if (timestamp && (!existing.timestamp || timestamp < existing.timestamp)) {
              existing.timestamp = timestamp;
            }
          } else {
            candidates.set(rootHash, {
              hash: rootHash,
              timestamp,
              tclAmount
            });
          }
        }

        const limit = Math.max(1, Math.floor(readNumber(CONFIG.pnlAggregatorBuyRootLimit, 180)));
        return Array.from(candidates.values())
          .sort((left, right) => right.timestamp - left.timestamp)
          .slice(0, limit);
      }

      function fetchAggregatorBuyFallbackTrades(transfers, walletAddress, knownTradeHashes = new Set()) {
        const candidates = collectAggregatorBuyCandidates(transfers, walletAddress, knownTradeHashes);
        if (!candidates.length) return [];

        // Index pe txHash al root-urilor care au deja operations in cache-ul Supabase.
        const rootByHash = new Map();
        for (const entry of Array.isArray(transfers) ? transfers : []) {
          const hash = String(entry?.txHash || "");
          if (!/^[0-9a-f]{64}$/i.test(hash)) continue;
          if (!Array.isArray(entry.operations) || !entry.operations.length) continue;
          if (!rootByHash.has(hash)) rootByHash.set(hash, entry);
        }

        const trades = [];
        let missingOps = 0;
        for (const candidate of candidates) {
          const rootTx = rootByHash.get(candidate.hash);
          // Root inca neenrichuit (operations=null) => il prinde worker-ul la urmatorul
          // sync/enrich; il sarim acum ca sa nu lovim MultiversX live.
          if (!rootTx) { missingOps += 1; continue; }
          const trade = parseAggregatorBuyTradeFromRoot(rootTx, candidate, walletAddress);
          if (trade) trades.push(trade);
        }
        if (missingOps) {
          console.warn(`PNL: ${missingOps} root(s) aggregator fara operations in Supabase (vor fi enrichuite la urmatorul sync).`);
        }

        return trades.sort((left, right) => left.timestamp - right.timestamp);
      }

      function aggregatePnlTrades(trades) {
        return trades.reduce((totals, trade) => {
          if (trade.side === "buy") {
            totals.buyCount += 1;
            totals.buyTcl += trade.tclAmount;
            totals.buyUsd += trade.volumeUsd;
          } else if (trade.side === "sell") {
            totals.sellCount += 1;
            totals.sellTcl += trade.tclAmount;
            totals.sellUsd += trade.volumeUsd;
          }
          totals.tradeCount += 1;
          return totals;
        }, {
          tradeCount: 0,
          buyCount: 0,
          sellCount: 0,
          buyTcl: 0,
          sellTcl: 0,
          buyUsd: 0,
          sellUsd: 0
        });
      }
// ── server orchestration (mirrors fetchPnlFromSupabase) ───────────────────────
const _PNL_COLS = "tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations";

async function computeWalletSwapPnl(pool, walletAddress) {
  // SELLS: wallet calls a swap function, sending TCL
  const sellRes = await pool.query(
    `SELECT ${_PNL_COLS} FROM tcl_transfers WHERE sender=$1 AND function = ANY($2::text[])`,
    [walletAddress, CONFIG.pnlSwapFunctions]
  );
  const sellRows = sellRes.rows.filter((row) => {
    const ft = Array.isArray(row.action_transfers) ? row.action_transfers[0] : null;
    return (ft && (ft.token || ft.identifier)) === CONFIG.tokens.tcl.identifier;
  });
  // BUYS: wallet receives TCL via an SCR from an MVX contract (not self, not the game contract)
  const buyRes = await pool.query(
    `SELECT ${_PNL_COLS} FROM tcl_transfers WHERE receiver=$1 AND sender LIKE 'erd1qqqq%' AND sender <> $2`,
    [walletAddress, CONFIG.pnlGameContract]
  );
  const buyRows = buyRes.rows.filter((r) => r.sender !== walletAddress && r.sender !== CONFIG.pnlGameContract && String(r.sender || "").startsWith("erd1qqqq"));

  const swapEntries = [...sellRows, ...buyRows].map(supabaseRowToPnlEntry);
  const timestamps = swapEntries.map((e) => Number(e.timestamp)).filter(Number.isFinite);
  const oldestTimestamp = timestamps.length ? Math.min(...timestamps) : null;

  if (swapEntries.length === 0) {
    return { buyTcl:0, buyCost:0, sellTcl:0, sellReceived:0, tradeCount:0, buyCount:0, sellCount:0, checkedSwaps:0, oldestTimestamp:null };
  }

  const rootHashes = Array.from(new Set(swapEntries.map((entry) => entry.originalTxHash || entry.txHash).filter(Boolean)));
  let relatedEntries = [];
  if (rootHashes.length) {
    const relRes = await pool.query(
      `SELECT ${_PNL_COLS} FROM tcl_transfers WHERE tx_hash = ANY($1::text[]) OR original_tx_hash = ANY($1::text[])`,
      [rootHashes]
    );
    relatedEntries = relRes.rows.map(supabaseRowToPnlEntry);
  }

  const transfers = [];
  const seen = new Set();
  [...relatedEntries, ...swapEntries].forEach((e, i) => {
    const hash = String(e.txHash || e.originalTxHash || `sb:${i}`);
    const key = `${hash}|${e.type || ""}|${e.sender || ""}|${e.receiver || ""}`;
    if (!seen.has(key)) { seen.add(key); transfers.push(e); }
  });

  let trades = parsePnlTrades(transfers, walletAddress);
  const aggregatorBuyTrades = await fetchAggregatorBuyFallbackTrades(
    transfers, walletAddress, new Set(trades.map((t) => t.hash).filter(Boolean))
  );
  if (aggregatorBuyTrades.length) {
    const merged = new Map();
    [...trades, ...aggregatorBuyTrades].forEach((t) => { if (t && t.hash) merged.set(t.hash, t); });
    trades = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  const totals = aggregatePnlTrades(trades);
  return {
    buyTcl: totals.buyTcl, buyCost: totals.buyUsd,
    sellTcl: totals.sellTcl, sellReceived: totals.sellUsd,
    tradeCount: totals.tradeCount, buyCount: totals.buyCount, sellCount: totals.sellCount,
    checkedSwaps: swapEntries.length, oldestTimestamp
  };
}

export { computeWalletSwapPnl };
