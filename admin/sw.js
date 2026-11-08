// Le service worker de l'admin : l'app s'ouvre même sans réseau (jusqu'à l'écran de connexion)
// et se met à jour toute seule. Il ne garde QUE les fichiers de l'app : jamais les réponses du
// serveur (clients, appels, comptes), ni GitHub, ni la page d'accueil du site.
// Tous les fichiers viennent de la copie de CETTE version, prise d'un bloc à l'installation : jamais
// un mélange d'ancien et de neuf (un module neuf avec un ancien empêcherait l'app de démarrer).
// Le réseau seulement pour un fichier qui manque. Changer VERSION à chaque mise en ligne de l'admin :
// la nouvelle version s'installe à côté et l'app propose « Mettre à jour ».
const VERSION = 'admin-2026-11-08-6';
const BASE = new URL('./', self.location.href).pathname;           // /admin/
const COQUILLE = [
  './', 'app.css', 'theme.js', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/appareil.js', 'js/argent.js', 'js/cles.js', 'js/clients.js', 'js/compte.js', 'js/confiance.js',
  'js/connexion.js', 'js/equipe.js', 'js/etat.js', 'js/formes.js', 'js/installer.js', 'js/navigation.js', 'js/outils.js', 'js/panneau.js', 'js/prospects.js',
  'js/qr.js', 'js/tableau.js', 'js/ui.js', 'js/vendor/qrcode.mjs',
  'icones/icone-192.png', 'icones/apple-touch-icon.png', 'icones/icone-admin.svg', 'icones/icone-admin-32.png', 'icones/icone-admin-192.png',
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
