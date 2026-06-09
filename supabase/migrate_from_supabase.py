#!/usr/bin/env python3
"""
Migrate data from old Supabase to self-hosted PostgreSQL.
Run: sudo -u postgres python3 migrate_from_supabase.py
"""
import json, time, sys
import urllib.request
import psycopg2
import psycopg2.extras

OLD_URL = "https://phhzrfzhwwooeqsdztee.supabase.co/rest/v1"
OLD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoaHpyZnpod3dvb2Vxc2R6dGVlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg4MjYzOSwiZXhwIjoyMDk1NDU4NjM5fQ.Ul3ptOt5Sg9s6vXzP5-mBcMGAxUOSk1QmcXUlxhdWC0"

# Connect as postgres (peer auth)
DB_DSN = "dbname=tcl_db user=postgres host=localhost"

PAGE = 1000  # rows per page

def sb_get(table, select="*", offset=0, limit=PAGE, extra_params=""):
    url = f"{OLD_URL}/{table}?select={select}&limit={limit}&offset={offset}{extra_params}"
    req = urllib.request.Request(url, headers={
        "apikey": OLD_KEY,
        "Authorization": f"Bearer {OLD_KEY}",
        "Prefer": "count=exact"
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode())
        return data

def migrate_table(conn, table, insert_fn, select="*", extra_params=""):
    print(f"\n--- Migrating {table} ---")
    cur = conn.cursor()
    offset = 0
    total = 0
    while True:
        rows = sb_get(table, select, offset, PAGE, extra_params)
        if not rows:
            break
        inserted = insert_fn(cur, rows)
        conn.commit()
        total += inserted
        print(f"  {total} rows inserted (batch of {len(rows)})")
        if len(rows) < PAGE:
            break
        offset += PAGE
        time.sleep(0.3)
    cur.close()
    print(f"  Done: {total} rows total")
    return total

def insert_tcl_transfers(cur, rows):
    if not rows:
        return 0
    psycopg2.extras.execute_values(cur,
        """INSERT INTO tcl_transfers
           (tx_hash, original_tx_hash, type, sender, receiver, ts,
            function, status, action_transfers, operations, enriched, synced_at)
           VALUES %s
           ON CONFLICT (tx_hash) DO UPDATE SET
             operations = EXCLUDED.operations,
             enriched = EXCLUDED.enriched""",
        [(
            r["tx_hash"], r.get("original_tx_hash"), r.get("type"),
            r["sender"], r["receiver"], r["ts"],
            r.get("function"), r.get("status", "success"),
            json.dumps(r["action_transfers"]) if r.get("action_transfers") is not None else None,
            json.dumps(r["operations"]) if r.get("operations") is not None else None,
            r.get("enriched", True),
            r.get("synced_at")
        ) for r in rows],
        page_size=200
    )
    return len(rows)

def insert_tcl_sync_state(cur, rows):
    if not rows:
        return 0
    psycopg2.extras.execute_values(cur,
        "INSERT INTO tcl_sync_state (key, value) VALUES %s ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [(r["key"], r["value"]) for r in rows],
        page_size=500
    )
    return len(rows)

def insert_ai_knowledge_chunks(cur, rows):
    if not rows:
        return 0
    psycopg2.extras.execute_values(cur,
        """INSERT INTO ai_knowledge_chunks
           (source_url, title, chunk, content_hash, active, created_at, updated_at)
           VALUES %s
           ON CONFLICT (content_hash) DO UPDATE SET
             chunk = EXCLUDED.chunk,
             active = EXCLUDED.active,
             updated_at = EXCLUDED.updated_at""",
        [(
            r.get("source_url", ""), r.get("title", ""), r["chunk"],
            r["content_hash"], r.get("active", True),
            r.get("created_at"), r.get("updated_at")
        ) for r in rows],
        page_size=200
    )
    return len(rows)

def insert_tcl_trades(cur, rows):
    if not rows:
        return 0
    psycopg2.extras.execute_values(cur,
        """INSERT INTO tcl_trades (tx_hash, ts, wallet, side, tcl_amount, usdc_amount, price, source, synced_at)
           VALUES %s ON CONFLICT (tx_hash) DO NOTHING""",
        [(
            r["tx_hash"], r["ts"], r["wallet"], r["side"],
            r["tcl_amount"], r["usdc_amount"], r["price"],
            r.get("source"), r.get("synced_at")
        ) for r in rows],
        page_size=500
    )
    return len(rows)

def main():
    print("=== TCL Supabase to Self-hosted PostgreSQL Migration ===")
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    try:
        migrate_table(conn, "tcl_sync_state", insert_tcl_sync_state)
        migrate_table(conn, "tcl_transfers", insert_tcl_transfers,
                      select="tx_hash,original_tx_hash,type,sender,receiver,ts,function,status,action_transfers,operations,enriched,synced_at",
                      extra_params="&order=ts.asc")
        migrate_table(conn, "tcl_trades", insert_tcl_trades,
                      extra_params="&order=ts.asc")
        migrate_table(conn, "ai_knowledge_chunks", insert_ai_knowledge_chunks,
                      select="source_url,title,chunk,content_hash,active,created_at,updated_at")
        print("\n=== Migration Complete! ===")
    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
