importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyBiJMsJ6etZ617BOeU31m7OXKkd5J6cdU0",
  authDomain: "closete-c624a.firebaseapp.com",
  projectId: "closete-c624a",
  storageBucket: "closete-c624a.firebasestorage.app",
  messagingSenderId: "471061912823",
  appId: "1:471061912823:web:b6214562b04030e6f447f2",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Background notification received:", payload);
  const title = payload.notification?.title || payload.data?.title || "Closeté Admin";
  const body = payload.notification?.body || payload.data?.body || "New update received";
  const dedupeKey =
    payload.data?.id ||
    payload.data?.notificationId ||
    payload.data?.eventKey ||
    `${title}::${body}`;

  const options = {
    body,
    icon: "/icon.png",
    tag: dedupeKey,
    renotify: false,
    data: payload.data || {},
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/pending-review";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    })
  );
});
