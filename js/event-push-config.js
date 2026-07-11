window.TCL_EVENT_PUSH_CONFIG = window.TCL_EVENT_PUSH_CONFIG || {
  // Push notifications (event reminders + claim reminders) are served by our
  // own VPS API, not Cloudflare.
  apiBaseUrl: "https://api.tclexplorer.com/api/push",

  // Optional fallback. Prefer /api/push/config so the key can be changed
  // without editing the static app.
  publicVapidKey: ""
};
