# TCL Event Push Worker

Cloudflare Worker backend for TCL Explorer event notifications.

Public endpoints:

- `GET /api/push/config`
- `GET /api/push/stats`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `POST /api/push/test`
- `POST /api/push/dispatch-events`

Files:

- `worker.js`: API + scheduled push dispatcher
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

After deploy, update `../js/event-push-config.js` with the Worker URL.

Current deployed Worker:

```text
https://tcl-event-push.alexaxel9719.workers.dev
```
