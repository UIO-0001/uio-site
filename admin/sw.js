// Le service worker de l'admin : l'app s'ouvre même sans réseau (jusqu'à l'écran de connexion)
// et se met à jour toute seule. Il ne garde QUE les fichiers de l'app : jamais les réponses du
// serveur (clients, appels, comptes), ni GitHub, ni la page d'accueil du site.
// Réseau d'abord (toujours la dernière version en ligne), copie gardée si le réseau manque.
// Changer VERSION à chaque mise en ligne de l'admin : l'app propose alors « Mettre à jour ».
const VERSION = 'admin-2026-11-08-3';
const BASE = new URL('./', self.location.href).pathname;           // /admin/
const COQUILLE = [
  './', 'app.css', 'theme.js', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/appareil.js', 'js/argent.js', 'js/cles.js', 'js/clients.js', 'js/compte.js', 'js/confiance.js',
  'js/connexion.js', 'js/equipe.js', 'js/etat.js', 'js/formes.js', 'js/installer.js', 'js/navigation.js', 'js/outils.js', 'js/panneau.js',
  'js/qr.js', 'js/tableau.js', 'js/ui.js', 'js/vendor/qrcode.mjs',
  'icones/icone-192.png', 'icones/apple-touch-icon.png',
  '../assets/fonts/hanken-grotesk.woff2', '../assets/logo/uio-icone-clair.png', '../assets/logo/uio-icone-sombre.png',
  '../assets/logo/uio-icone.svg'
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
  e.respondWith(reseauPuisCopie(page ? BASE : u.pathname, u.href, e, page));
});

async function reseauPuisCopie(cle, adresse, e, page) {
  const cache = await caches.open(VERSION);
  const reseau = fetch(adresse, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' }).then(async reponse => {
    // Une page ne peut pas être servie comme « redirigée » : on en refait une réponse simple
    if (page && reponse.redirected) reponse = new Response(await reponse.blob(), { status: reponse.status, headers: reponse.headers });
    if (reponse.ok && reponse.type !== 'opaque') cache.put(cle, reponse.clone());
    return reponse;
  });
  e.waitUntil(reseau.catch(() => {}));
  // Réseau lent (plus de 4 secondes) ou absent : la copie gardée, si elle existe
  const lent = new Promise(resoudre => setTimeout(resoudre, 4000, null));
  try {
    const reponse = await Promise.race([reseau, lent]);
    if (reponse && reponse.ok) return reponse;
  } catch (err) { /* hors ligne */ }
  const copie = await cache.match(cle, { ignoreSearch: true });
  if (copie) return copie;
  return reseau;
}
