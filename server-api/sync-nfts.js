/**
 * TCL NFT Indexer
 * Fetches all TCL game NFTs from MultiversX API and stores them in PostgreSQL.
 * Run manually: node sync-nfts.js
 * Or via PM2 cron: every 30 minutes
 */

import { readFileSync } from "fs";
import pg from "pg";

// Load .env
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

const MVX_API = "https://api.multiversx.com";
const TCL_CREATORS = [
  "erd1tpayjteeg67rq7me94k36705dh2c077xjsmhzdmkkwjeg0w00ufsmmltyc",
  "erd1qqqqqqqqqqqqqpgqm77vv5dcqs6kuzhj540vf67f90xemypd0ufsygvnvk",
];
const BATCH_SIZE = 100;   // MultiversX max per request
const DELAY_MS   = 300;   // polite delay between requests

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
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
      `${MVX_API}/collections/${collection}/nfts?size=${BATCH_SIZE}&from=${from}&fields=identifier,collection,nonce,name,media,metadata,royalties,creator,owner,supply`
    );

    if (!nfts.length) break;

    const db = await pool.connect();
    try {
      for (const nft of nfts) {
        const image = nft.media?.[0]?.url || nft.media?.[0]?.thumbnailUrl || null;
        await db.query(`
          INSERT INTO tcl_nfts
            (identifier, collection, nonce, name, image_url, metadata, royalties, creator, owner, supply, raw_api, synced_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
          ON CONFLICT (identifier) DO UPDATE SET
            name=$4, image_url=$5, metadata=$6, royalties=$7, owner=$9,
            raw_api=$11, updated_at=NOW()
        `, [
          nft.identifier,
          nft.collection,
          nft.nonce,
          nft.name,
          image,
          nft.metadata || null,
          nft.royalties || 0,
          nft.creator || null,
          nft.owner || null,
          nft.supply || "1",
          nft,
        ]);
      }
    } finally {
      db.release();
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
