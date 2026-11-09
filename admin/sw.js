// Le service worker du CRM : l'app s'ouvre même sans réseau (jusqu'à l'écran de connexion),
// se met à jour toute seule, et montre les notifications (Réglages → Notifications). Il ne garde QUE les fichiers de l'app : jamais les réponses du
// serveur (clients, appels, comptes), ni GitHub, ni la page d'accueil du site.
// Tous les fichiers viennent de la copie de CETTE version, prise d'un bloc à l'installation : jamais
// un mélange d'ancien et de neuf (un module neuf avec un ancien empêcherait l'app de démarrer).
// Le réseau seulement pour un fichier qui manque. Changer VERSION à chaque mise en ligne du CRM
// (toujours « admin-… » : le ménage des anciennes versions cherche ce début) :
// la nouvelle version s'installe à côté et l'app propose « Mettre à jour ».
const VERSION = 'admin-2026-11-09-1';
const BASE = new URL('./', self.location.href).pathname;           // /admin/
const COQUILLE = [
  './', 'app.css', 'theme.js', 'manifest.webmanifest',
  'js/afaire.js', 'js/app.js', 'js/api.js', 'js/appareil.js', 'js/argent.js', 'js/cles.js', 'js/clients.js', 'js/compte.js', 'js/confiance.js',
  'js/connexion.js', 'js/equipe.js', 'js/etat.js', 'js/fiche.js', 'js/formes.js', 'js/installer.js', 'js/navigation.js', 'js/notifications.js', 'js/outils.js', 'js/panneau.js', 'js/prospects.js', 'js/rapport.js', 'js/recherche.js',
  'js/qr.js', 'js/tableau.js', 'js/ui.js', 'js/vendor/qrcode.mjs',
  'icones/icone-192.png', 'icones/apple-touch-icon.png', 'icones/icone-admin.svg', 'icones/icone-admin-32.png', 'icones/icone-admin-192.png', 'icones/badge-96.png',
  '../assets/fonts/hanken-grotesk.woff2'
].map(chemin => new URL(chemin, self.location.href).pathname);
const GARDES = new Set(COQUILLE);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(cache => cache.addAll(COQUILLE.map(chemin => new Request(chemin, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom.startsWith('admin-') && nom !== VERSION) await caches.delete(nom);
    await self.clients.claim();
  })());
});

// « Mettre à jour » dans l'app : la nouvelle version prend la place tout de suite
self.addEventListener('message', e => { if (e.data === 'passer') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;                   // serveur, GitHub : toujours le réseau
  const page = r.mode === 'navigate' && u.pathname.startsWith(BASE);
  if (!page && !GARDES.has(u.pathname)) return;                     // la page d'accueil et le reste du site : le réseau
  e.respondWith(depuisLaVersion(page ? BASE : u.pathname, r, page));
});

async function depuisLaVersion(cle, requete, page) {
  const cache = await caches.open(VERSION);
  const copie = await cache.match(cle, { ignoreSearch: true });
  if (!copie) return fetch(requete);
  // Une page ne peut pas être servie comme « redirigée » : on en refait une réponse simple
  if (page && copie.redirected) return new Response(await copie.blob(), { status: copie.status, statusText: copie.statusText, headers: copie.headers });
  return copie;
}

// ─── Les notifications ─────────────────────────────────────────────────────
// Le serveur chiffre chaque avis pour cet appareil ; le navigateur le déchiffre avant de le donner ici.
// Toujours montrer l'avis (sur iPhone, un avis jamais montré fait couper les notifications).
const LIEN_RE = /^#[a-z]{2,20}$/;
const ICONE = new URL('icones/icone-admin-192.png', self.location.href).href;
const BADGE = new URL('icones/badge-96.png', self.location.href).href;

self.addEventListener('push', e => {
  let avis = {};
  try { avis = (e.data && e.data.json()) || {}; } catch (err) { avis = {}; }
  const tag = String(avis.tag || 'uio').slice(0, 60);
  e.waitUntil(self.registration.showNotification(String(avis.titre || 'UIO CRM').slice(0, 90), {
    body: String(avis.corps || '').slice(0, 400), tag, renotify: true, icon: ICONE, badge: BADGE,
    timestamp: Number(avis.quand) || Date.now(), requireInteraction: !!avis.urgent,
    data: { lien: LIEN_RE.test(avis.url || '') ? avis.url : '#tableau' }
  }));
});

// Touchée : l'admin déjà ouvert passe à l'onglet de l'avis ; sinon, l'admin s'ouvre sur cet onglet
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const lien = LIEN_RE.test(d.lien || '') ? d.lien : '#tableau';
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const admin = fenetres.find(f => new URL(f.url).pathname.startsWith(BASE));
    if (admin) {
      try { await admin.focus(); } catch (err) { /* le navigateur garde la main */ }
      admin.postMessage({ type: 'uio-aller', lien });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(BASE + lien);
  })());
});
