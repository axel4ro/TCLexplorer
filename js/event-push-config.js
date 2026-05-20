window.TCL_EVENT_PUSH_CONFIG = window.TCL_EVENT_PUSH_CONFIG || {
  // After deploying cloudflare-worker/, set this to the Worker URL + /api/push.
  // Example:
  // apiBaseUrl: "https://tcl-event-push.your-account.workers.dev/api/push"
  apiBaseUrl: "https://tcl-event-push.axel4ro.workers.dev/api/push",

  // Optional fallback. Prefer /api/push/config so the key can be changed
  // without editing the static app.
  publicVapidKey: ""
};
