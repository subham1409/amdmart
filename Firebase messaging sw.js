// firebase-messaging-sw.js — receives push messages while the website is closed.
// IMPORTANT: this file must sit in the ROOT of the website, next to index.html (same folder).
// The web config below is public by design (same as firebase.js).
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBSw9p-3xBLKHQUywSjF2Xg8NUsREI9qzE",
  authDomain: "amdmart-cb4d9.firebaseapp.com",
  databaseURL: "https://amdmart-cb4d9-default-rtdb.firebaseio.com",
  projectId: "amdmart-cb4d9",
  storageBucket: "amdmart-cb4d9.firebasestorage.app",
  messagingSenderId: "815864203042",
  appId: "1:815864203042:web:dac0ac0ad0e47b92c0877b",
  measurementId: "G-363961WHM1"
});

const messaging = firebase.messaging();
const LOGO = "https://i.ibb.co/tpyCskfp/75-C80-FC1-2585-45-E3-BF9-A-DBAFA069-ED0-B.png";

// Messages from the Firebase console ("Notification" messages) are shown automatically by the browser.
// This handler only covers "data-only" messages (title / body / url sent as data).
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const d = payload.data || {};
  self.registration.showNotification(d.title || "AMD Mart", {
    body: d.body || "",
    icon: d.icon || LOGO,
    data: { url: d.url || "/" }
  });
});

// Tapping a data-only notification opens (or focuses) the website.
self.addEventListener("notificationclick", (event) => {
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;   // console notifications are opened by the Firebase SDK itself
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return clients.openWindow(url);
  }));
});