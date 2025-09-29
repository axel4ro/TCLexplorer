self.addEventListener("install", event => {
  console.log("✅ Service Worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  console.log("✅ Service Worker activated");
});

// === Ascultă push notificări ===
self.addEventListener("push", event => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "images/tcl_icon.png",
      badge: "images/tcl_icon.png"
    })
  );
});
