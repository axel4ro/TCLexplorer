/**
 * TCL NFT Indexer
 * Fetches all TCL game NFTs from MultiversX API and stores them in PostgreSQL.
 * Also fetches SC-specific attributes (quality, wave, bonus, crystal, socket, storage, refinement).
 * Run manually: node sync-nfts.js
 * Or via PM2 cron: every 30 minutes
 */

import { readFileSync } from "fs";
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
  max: 5,
});

const MVX_API      = "https://api.multiversx.com";
const TCL_GAME_SC  = "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk";
const TCL_CREATORS = [
  "erd1tpayjteeg67rq7me94k36705dh2c077xjsmhzdmkkwjeg0w00ufsmmltyc",
  "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk",
];
const BATCH_SIZE  = 100;
const DELAY_MS    = 800;
const SC_PARALLEL = 3; // NFTs per SC attribute batch (3 NFTs × 8 calls = 24 parallel SC requests)

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const wait = 2000 * (i + 1);
      console.warn(`  429 rate limit on ${url.split("?")[0].split("/").slice(-2).join("/")} — waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.json();
  }
  throw new Error(`Max retries exceeded — ${url}`);
}

// ── SC vm-values query ─────────────────────────────────────────────────────────
async function scQuery(funcName, collectionId, nonce) {
  const body = {
    scAddress: TCL_GAME_SC,
    funcName,
    args: [
      Buffer.from(collectionId).toString("hex"),
      BigInt(nonce).toString(16).padStart(16, "0"),
    ],
  };
  try {
    const r = await fetch(`${MVX_API}/vm-values/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    const b64 = d?.data?.data?.returnData?.[0];
    if (b64 === undefined || b64 === null) return null;
    if (b64 === "") return 0n;
    const hex = Buffer.from(b64, "base64").toString("hex");
    return hex ? BigInt("0x" + hex) : 0n;
  } catch {
    return null;
  }
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
    sc_socket_count:   socketCount   !== null ? Number(socketCount)   : null,
    sc_tcl_count:      tclCount      !== null ? tclCount.toString()    : null,
    sc_tcl_max:        tclMax        !== null ? tclMax.toString()      : null,
    sc_refinement_ts:  refinementTs  !== null ? Number(refinementTs)   : null,
    sc_quality:        quality       !== null ? Number(quality)        : null,
    sc_wave:           wave          !== null ? Number(wave)           : null,
    sc_has_bonus:      hasBonus      !== null ? hasBonus > 0n          : null,
    sc_has_crystal:    hasCrystal    !== null ? hasCrystal > 0n        : null,
  };
}

// ── Sync collections ──────────────────────────────────────────────────────────
async function syncCollections() {
  console.log("Syncing collections...");
  const all = [];
  for (const creator of TCL_CREATORS) {
    await sleep(DELAY_MS);
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
    console.log(`  Upserted ${all.length} collections`);
  } finally {
    db.release();
  }
  return all;
}

// ── Sync NFTs for one collection ──────────────────────────────────────────────
async function syncCollectionNFTs(collection) {
  let from = 0;
  let total = 0;

  while (true) {
    await sleep(DELAY_MS);
    const nfts = await fetchJson(
      `${MVX_API}/collections/${collection}/nfts?size=${BATCH_SIZE}&from=${from}` +
      `&fields=identifier,collection,nonce,name,media,metadata,royalties,creator,owner,supply`
    );

    if (!nfts.length) break;

    // Fetch SC attributes in parallel batches
    for (let i = 0; i < nfts.length; i += SC_PARALLEL) {
      const batch = nfts.slice(i, i + SC_PARALLEL);
      const attrsArr = await Promise.all(
        batch.map(n => fetchScAttrs(n.collection, n.nonce))
      );

      const db = await pool.connect();
      try {
        for (let j = 0; j < batch.length; j++) {
          const nft   = batch[j];
          const attrs = attrsArr[j];
          const image = nft.media?.[0]?.url || nft.media?.[0]?.thumbnailUrl || null;
          await db.query(`
            INSERT INTO tcl_nfts
              (identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner, supply,
               sc_quality, sc_wave, sc_has_bonus, sc_has_crystal,
               sc_socket_count, sc_tcl_count, sc_tcl_max, sc_refinement_ts,
               raw_api, synced_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
            ON CONFLICT (identifier) DO UPDATE SET
              name=$4, image_url=$5, metadata=$6, royalties=$7, owner=$9,
              sc_quality=$11, sc_wave=$12, sc_has_bonus=$13, sc_has_crystal=$14,
              sc_socket_count=$15, sc_tcl_count=$16, sc_tcl_max=$17, sc_refinement_ts=$18,
              raw_api=$19, updated_at=NOW()
          `, [
            nft.identifier, nft.collection, nft.nonce, nft.name,
            image, nft.metadata || null, nft.royalties || 0,
            nft.creator || null, nft.owner || null, nft.supply || "1",
            attrs.sc_quality, attrs.sc_wave, attrs.sc_has_bonus, attrs.sc_has_crystal,
            attrs.sc_socket_count, attrs.sc_tcl_count, attrs.sc_tcl_max, attrs.sc_refinement_ts,
            nft,
          ]);
        }
      } finally {
        db.release();
      }
    }

    total += nfts.length;
    from  += nfts.length;
    process.stdout.write(`\r  ${collection}: ${total} NFTs indexed...`);

    if (nfts.length < BATCH_SIZE) break;
  }

  console.log(`\r  ${collection}: ${total} NFTs ✓                     `);
  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== TCL NFT Sync — ${new Date().toISOString()} ===\n`);
  const start = Date.now();

  const collections = await syncCollections();
  let grand = 0;

  for (const col of collections) {
    try {
      grand += await syncCollectionNFTs(col.collection);
    } catch (err) {
      console.error(`  Error syncing ${col.collection}:`, err.message);
    }
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone! ${grand} NFTs indexed in ${secs}s`);
  await pool.end();
}

main().catch(err => {
  console.error("Sync failed:", err);
  process.exit(1);
});
