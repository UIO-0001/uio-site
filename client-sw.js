// Le service worker de l'espace client (agenceuio.ca/client.html) : il rend l'espace installable
// (« Sur l'écran d'accueil ») et montre les notifications de nouvelles demandes (notifs_clients.py).
// Il ne garde AUCUNE page ni aucune réponse du serveur : tout vient toujours du réseau.
const ICONE = '/assets/app/icone-192.png';
const BADGE = '/assets/app/badge-96.png';
const PAGE = '/client.html';
const LIEN_RE = /^#[a-z]{2,20}$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let avis = {};
  try { avis = (e.data && e.data.json()) || {}; } catch (err) { avis = {}; }
  e.waitUntil(self.registration.showNotification(String(avis.titre || 'Votre espace client').slice(0, 90), {
    body: String(avis.corps || '').slice(0, 300), tag: String(avis.tag || 'demande').slice(0, 60), renotify: true,
    icon: ICONE, badge: BADGE, timestamp: Number(avis.quand) || Date.now(),
    data: { lien: LIEN_RE.test(avis.url || '') ? avis.url : '#demandes' }
  }));
});

// Touchée : l'espace déjà ouvert passe aux demandes ; sinon, il s'ouvre dessus.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const lien = LIEN_RE.test((e.notification.data || {}).lien || '') ? e.notification.data.lien : '#demandes';
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ouverte = fenetres.find(f => new URL(f.url).pathname === PAGE);
    if (ouverte) {
      try { await ouverte.focus(); } catch (err) { /* le navigateur garde la main */ }
      ouverte.postMessage({ type: 'uio-aller', lien });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(PAGE + lien);
  })());
});
