# Event Push Notifications: Cloudflare Workers + KV

This setup keeps the TCL Explorer site static on GitHub Pages and runs the
push backend on Cloudflare Workers with Workers KV.

The browser/PWA still needs one manual `Enable` click on each device. That is a
browser permission rule, not an app setting we can bypass.

## What Runs Where

- GitHub Pages: `index.html`, `sw.js`, `js/event-notifications.js`
- Cloudflare Worker: `cloudflare-worker/worker.js`
- Cloudflare KV: stores browser push subscriptions, claim reminders, and sent-notification locks
- Cloudflare Cron Trigger: runs every 5 minutes and sends due event and claim reminders

## 1. Generate VAPID Keys

Run from the repository root:

```bash
node cloudflare-worker/generate-vapid-keys.mjs
```

Keep both values. The `publicKey` goes in `wrangler.toml`; the `privateKey`
must be saved as a Cloudflare secret.

## 2. Create The KV Namespace

```bash
npx wrangler kv namespace create TCL_EVENT_PUSH_KV
```

Copy the returned namespace `id` into:

```toml
cloudflare-worker/wrangler.toml
```

Replace:

```toml
id = "REPLACE_WITH_KV_NAMESPACE_ID"
```

## 3. Configure Worker Variables

In `cloudflare-worker/wrangler.toml`, replace:

```toml
VAPID_PUBLIC_KEY = "REPLACE_WITH_VAPID_PUBLIC_KEY"
```

Then set secrets:

```bash
cd cloudflare-worker
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put EVENT_PUSH_CRON_SECRET
```

Use a long random value for `EVENT_PUSH_CRON_SECRET`. It is only needed for
manual dispatch calls; the Cloudflare scheduled handler runs without it.

For local browser testing, temporarily set `EVENT_PUSH_ALLOWED_ORIGIN = "*"`
or add your localhost origin in `wrangler.toml`.

## 4. Deploy The Worker

```bash
cd cloudflare-worker
npx wrangler deploy
```

The Worker URL will look like:

```text
https://tcl-event-push.YOUR_ACCOUNT.workers.dev
```

Current deployment:

```text
https://tcl-event-push.axel4ro.workers.dev
```

## 5. Point The Static Site To The Worker

Edit:

```text
js/event-push-config.js
```

Set:

```js
window.TCL_EVENT_PUSH_CONFIG = {
  apiBaseUrl: "https://tcl-event-push.axel4ro.workers.dev/api/push",
  publicVapidKey: ""
};
```

Deploy the static site to GitHub Pages as usual.

## 6. Test

Open the Events page on HTTPS, press `Enable`, then press `Test`.

Open the Claim Reminder page on HTTPS, enter the remaining automatic-claim days,
then press `Save / Update`. Use `Save / Update` again whenever the player extends
the in-game automatic claim period.

Useful endpoints:

```text
GET  /api/push/config
GET  /api/push/stats
POST /api/push/subscribe
POST /api/push/unsubscribe
POST /api/push/test
POST /api/push/dispatch-events
POST /api/push/claim/upsert
POST /api/push/claim/delete
POST /api/push/claim/status
POST /api/push/claim/test
GET  /api/push/claim/stats
POST /api/push/dispatch-claims
```

Manual dispatch needs:

```http
Authorization: Bearer EVENT_PUSH_CRON_SECRET
```

## iPhone/iPad Note

For background Web Push on iOS/iPadOS, the site should be added to the Home
Screen and opened as an installed web app before enabling notifications.
