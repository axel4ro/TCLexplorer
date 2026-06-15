/**
 * TCL NFT Indexer — Incremental cu updatedAfter per-collection
 *
 * Optimizari:
 *  - Stare salvata PER COLECTIE: daca e ucis la jumatate, urmatorul run reia de unde a ramas
 *  - updatedAfter: fetches DOAR NFT-urile schimbate de la ultimul sync
 *  - Colectiile se citesc din DB (cache 1h), nu din API la fiecare run
 *  - Interval 15 min in loc de 5 min
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import pg from "pg";

try {
  readFileSync("/opt/tcl-api/.env", "utf8").split("\n").forEach(line => {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#")) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  });
} catch { /* optional */ }

const { Pool } = pg;
const pool = new Pool({
  database: process.env.DB_NAME || "tcl_db",
  user:     process.env.DB_USER || "tcl_app",
  password: process.env.DB_PASSWORD,
  host:     process.env.DB_HOST || "127.0.0.1",
  port:     Number(process.env.DB_PORT) || 5432,
  max: 10,
});

const MVX_API      = "https://api.multiversx.com";
const TCL_GAME_SC  = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";
const TCL_CREATORS = [
  "erd1tpayjteeg67rq7me94k36705dh2c077xjsmhzdmkkwjeg0w00ufsmmltyc",
  "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk",
];

const BATCH_SIZE    = 100;
const SC_PARALLEL   = 5;
const DELAY_BETWEEN = 600;
const DELAY_COL     = 2000;
const STATE_FILE    = "/opt/tcl-api/logs/sync-state.json";
const COL_CACHE_TTL = 60 * 60 * 1000; // 1h

const sleep = ms => new Promise(r => setTimeout(r, ms));
let stats = { total: 0, inserted: 0, sc_synced: 0, skipped: 0, start: Date.now() };

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── State: per-collection timestamps + col cache refresh ────────────────────
// State format: { cols: { "TCLARMOUR-xxx": UNIX_TS, ... }, col_refresh: UNIX_MS }

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { cols: {}, col_refresh: 0 };
}

function saveState(state) {
  try { mkdirSync("/opt/tcl-api/logs", { recursive: true }); } catch {}
  try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

// ── HTTP cu retry exponential ───────────────────────────────────────────────

async function fetchJson(url, retries = 8) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const wait = Math.min(3000 * Math.pow(2, i), 90_000);
        log(`  429 — wait ${(wait / 1000).toFixed(0)}s (${url.slice(0, 80)})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      return res.json();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

// ── SC queries ──────────────────────────────────────────────────────────────

async function scQuery(funcName, collectionId, nonce, retries = 3) {
  const body = {
    scAddress: TCL_GAME_SC,
    funcName,
    args: [
      Buffer.from(collectionId).toString("hex"),
      BigInt(nonce).toString(16).padStart(16, "0"),
    ],
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${MVX_API}/vm-values/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      const d = await r.json();
      const b64 = d?.data?.data?.returnData?.[0];
      if (b64 === undefined || b64 === null || b64 === "") return 0n;
      const hex = Buffer.from(b64, "base64").toString("hex");
      return hex ? BigInt("0x" + hex) : 0n;
    } catch {
      if (i === retries) return null;
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

async function fetchScAttrs(collectionId, nonce) {
  const [socketCount, tclCount, tclMax, refinementTs, quality, wave, hasBonus, hasCrystal] =
    await Promise.all([
      scQuery("getSocketCount",         collectionId, nonce),
      scQuery("getTclCount",            collectionId, nonce),
      scQuery("getTclMax",              collectionId, nonce),
      scQuery("getRefinementTimestamp", collectionId, nonce),
      scQuery("getNftQuality",          collectionId, nonce),
      scQuery("getNftWave",             collectionId, nonce),
      scQuery("getHasBonus",            collectionId, nonce),
      scQuery("getHasCrystal",          collectionId, nonce),
    ]);
  return {
    sc_socket_count:  socketCount   !== null ? Number(socketCount)   : null,
    sc_tcl_count:     tclCount      !== null ? tclCount.toString()    : null,
    sc_tcl_max:       tclMax        !== null ? tclMax.toString()      : null,
    sc_refinement_ts: refinementTs  !== null ? Number(refinementTs)   : null,
    sc_quality:       quality       !== null ? Number(quality)        : null,
    sc_wave:          wave          !== null ? Number(wave)           : null,
    sc_has_bonus:     hasBonus      !== null ? hasBonus > 0n          : null,
    sc_has_crystal:   hasCrystal    !== null ? hasCrystal > 0n        : null,
  };
}

// ── Colectii: din DB cu refresh din API o data pe ora ───────────────────────

async function getCollections(state) {
  const now = Date.now();
  const needRefresh = now - (state.col_refresh || 0) > COL_CACHE_TTL;

  if (needRefresh) {
    log("Refreshing collections from API...");
    const all = [];
    for (const creator of TCL_CREATORS) {
      const cols = await fetchJson(`${MVX_API}/collections?creator=${creator}&size=50`);
      all.push(...cols.filter(c => !c.collection.startsWith("TCLSPONSOR")));
    }
    const db = await pool.connect();
    try {
      for (const col of all) {
        const image = col.assets?.pngUrl || col.assets?.svgUrl || null;
        await db.query(`
          INSERT INTO tcl_collections (collection, name, image_url, creator, nft_count, raw_api, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,NOW())
          ON CONFLICT (collection) DO UPDATE SET
            name=$2, image_url=$3, nft_count=$5, raw_api=$6, synced_at=NOW()
        `, [col.collection, col.name, image, col.creator || TCL_CREATORS[0], col.nftCount || 0, col]);
      }
      log(`  Upserted ${all.length} collections`);
    } finally {
      db.release();
    }
    state.col_refresh = now;
    saveState(state);
  } else {
    const minsLeft = Math.round((COL_CACHE_TTL - (now - state.col_refresh)) / 60000);
    log(`Collections from DB cache (API refresh in ${minsLeft}min)`);
  }

  const db = await pool.connect();
  try {
    const { rows } = await db.query(`SELECT collection FROM tcl_collections ORDER BY collection`);
    return rows;
  } finally {
    db.release();
  }
}

// ── DB state pentru o colectie ──────────────────────────────────────────────

async function loadDbState(collection) {
  const db = await pool.connect();
  try {
    const { rows } = await db.query(
      `SELECT identifier, owner, sc_tcl_max FROM tcl_nfts WHERE collection = $1`,
      [collection]
    );
    const map = {};
    for (const r of rows) map[r.identifier] = { owner: r.owner, hasSc: r.sc_tcl_max !== null };
    return map;
  } finally {
    db.release();
  }
}

// ── NFT sync incremental cu updatedAfter ────────────────────────────────────

async function syncCollectionNFTs(collection, updatedAfter) {
  const dbState = await loadDbState(collection);
  let from = 0;
  let total = 0;
  const afterParam = updatedAfter > 0 ? `&updatedAfter=${updatedAfter}` : "";

  while (true) {
    await sleep(DELAY_BETWEEN);
    const nfts = await fetchJson(
      `${MVX_API}/collections/${collection}/nfts?size=${BATCH_SIZE}&from=${from}${afterParam}` +
      `&fields=identifier,collection,nonce,name,media,metadata,royalties,creator,owner,supply`
    );
    if (!nfts || !nfts.length) break;

    const needSc = nfts.filter(n => {
      const db = dbState[n.identifier];
      if (!db) return true;           // NFT nou
      if (!db.hasSc) return true;     // fara date SC inca
      if (db.owner !== n.owner) return true;  // owner schimbat (equip/unequip/transfer)
      if (updatedAfter > 0) return true;  // incremental: NFT a fost modificat recent (equip/unequip)
      return false;
    });
    stats.skipped += nfts.length - needSc.length;

    const scMap = {};
    for (let i = 0; i < needSc.length; i += SC_PARALLEL) {
      const batch = needSc.slice(i, i + SC_PARALLEL);
      const attrsArr = await Promise.all(
        batch.map(n => fetchScAttrs(n.collection, n.nonce))
      );
      for (let j = 0; j < batch.length; j++) {
        scMap[batch[j].identifier] = attrsArr[j];
      }
      stats.sc_synced += batch.length;
    }

    const db = await pool.connect();
    try {
      for (const nft of nfts) {
        const attrs = scMap[nft.identifier];
        const image = nft.media?.[0]?.url || nft.media?.[0]?.thumbnailUrl || null;
        const isNew = !dbState[nft.identifier];

        if (isNew || attrs) {
          await db.query(`
            INSERT INTO tcl_nfts
              (identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner, supply,
               sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
               sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts,
               raw_api, synced_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
            ON CONFLICT (identifier) DO UPDATE SET
              name=$4, image_url=$5, metadata=$6, royalties=$7, owner=$9,
              sc_quality=COALESCE($11, tcl_nfts.sc_quality),
              sc_wave=COALESCE($12, tcl_nfts.sc_wave),
              sc_has_bonus=COALESCE($13, tcl_nfts.sc_has_bonus),
              sc_has_crystal=COALESCE($14, tcl_nfts.sc_has_crystal),
              sc_socket_count=COALESCE($15, tcl_nfts.sc_socket_count),
              sc_tcl_count=COALESCE($16, tcl_nfts.sc_tcl_count),
              sc_tcl_max=COALESCE($17, tcl_nfts.sc_tcl_max),
              sc_refinement_ts=COALESCE($18, tcl_nfts.sc_refinement_ts),
              raw_api=$19, updated_at=NOW()
          `, [
            nft.identifier, nft.collection, nft.nonce, nft.name,
            image, nft.metadata || null, nft.royalties || 0,
            nft.creator || null, nft.owner || null, nft.supply || "1",
            attrs?.sc_quality ?? null, attrs?.sc_wave ?? null,
            attrs?.sc_has_bonus ?? null, attrs?.sc_has_crystal ?? null,
            attrs?.sc_socket_count ?? null, attrs?.sc_tcl_count ?? null,
            attrs?.sc_tcl_max ?? null, attrs?.sc_refinement_ts ?? null,
            nft,
          ]);
          if (isNew) stats.inserted++;
        } else {
          await db.query(
            `UPDATE tcl_nfts SET owner=$2, updated_at=NOW() WHERE identifier=$1`,
            [nft.identifier, nft.owner]
          );
        }
        stats.total++;
      }
    } finally {
      db.release();
    }

    total += nfts.length;
    from  += nfts.length;
    if (nfts.length < BATCH_SIZE) break;
  }

  if (total > 0) log(`  ${collection}: ${total} NFTs procesate (${updatedAfter > 0 ? "incremental" : "full"})`);
  return total;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log(`=== TCL NFT Sync — ${new Date().toISOString()} ===`);
  const start = Date.now();
  stats.start = start;

  const state = loadState();
  if (!state.cols) state.cols = {};

  const syncStartTs = Math.floor(Date.now() / 1000);
  const collections = await getCollections(state);

  const pending = collections.filter(c => !state.cols[c.collection]);
  const incremental = collections.filter(c => !!state.cols[c.collection]);

  if (pending.length > 0) {
    log(`Initial sync: ${pending.length} colectii noi + ${incremental.length} incrementale`);
  } else {
    log(`Sync incremental: ${incremental.length} colectii`);
  }

  const allCols = [...pending, ...incremental];

  for (let i = 0; i < allCols.length; i++) {
    if (i > 0) await sleep(DELAY_COL);
    const col = allCols[i].collection;
    const updatedAfter = state.cols[col] || 0;
    try {
      await syncCollectionNFTs(col, updatedAfter);
      // Salveaza progresul dupa fiecare colectie — supravietuieste kill-ului de cron
      state.cols[col] = syncStartTs;
      saveState(state);
    } catch (err) {
      log(`  ERROR ${col}: ${err.message}`);
    }
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  log(`Done! total=${stats.total} new=${stats.inserted} sc=${stats.sc_synced} skip=${stats.skipped} in ${secs}s`);

  await pool.end();
}

main().catch(err => {
  log(`Sync failed: ${err.message}`);
  process.exit(1);
});