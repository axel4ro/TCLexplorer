# TCL Cloudflare Worker

Cloudflare Worker backend for TCL Explorer event notifications and analytics caching.

Public endpoints:

- `GET /api/analytics`
- `GET /api/volume`
- `GET /api/technicals`
- `GET /api/push/config`
- `GET /api/push/stats`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `POST /api/push/test`

Protected endpoints:

- `POST /api/analytics/refresh`
- `POST /api/volume/refresh`
- `POST /api/technicals/refresh`
- `POST /api/push/dispatch-events`

Files:

- `worker.js`: API, scheduled push dispatcher, scheduled analytics, volume, and technicals cache refresh
- `wrangler.toml`: Worker, KV binding and cron config
- `generate-vapid-keys.mjs`: dependency-free VAPID key generator
- `.dev.vars.example`: local secret template

Quick commands:

```bash
node generate-vapid-keys.mjs
npx wrangler kv namespace create TCL_EVENT_PUSH_KV
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put EVENT_PUSH_CRON_SECRET
npx wrangler deploy
```

The analytics endpoint refreshes CryptoRank data into Workers KV on the existing cron schedule.
`ANALYTICS_REFRESH_INTERVAL_MINUTES` controls how often the cache is refreshed; the site reads
`/api/analytics` directly from Cloudflare.

The volume endpoint refreshes TCL / USDC flow data into Workers KV and merges recent
MultiversX transfers into a cached monthly snapshot. `VOLUME_REFRESH_INTERVAL_MINUTES`
controls how often the cache is refreshed.

The technicals endpoint stores the parsed TCL / USDC swap history in Workers KV, so the
Technicals page can build indicators from Cloudflare data instead of scanning MultiversX
from the browser. `TECHNICALS_REFRESH_INTERVAL_MINUTES` controls how often the cache is
refreshed.

After deploy, update `../js/event-push-config.js` with the Worker URL.

Current deployed Worker:

```text
https://tcl-event-push.axel4ro.workers.dev
```
