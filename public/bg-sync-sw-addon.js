/* M3-B: optional Background Sync signal — does NOT run the sync engine itself. */
self.addEventListener('sync', function (event) {
  if (!event || event.tag !== 'car-care-outbox') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        clients[i].postMessage({ type: 'car-care-bg-sync', tag: event.tag });
      }
    }),
  );
});
