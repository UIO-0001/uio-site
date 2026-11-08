// Le chef d'orchestre : démarrage, entrée et verrouillage, minuteries, clavier,
// thème, bandeau « installer l'app » et mises à jour de l'app (service worker).
import { $, $$, lire, ecrire, toast, estInstallee, estTelephone } from './outils.js';
import { E, DELAIS, TITRE, VERROU_APRES } from './etat.js';
import { sessionActuelle, relireSession, oublierSession, quandSessionPerdue, fermerSession } from './api.js';
import { adresseScript } from './confiance.js';
import { VUES, montrer, vueDuLien, placerLentille, quandVue } from './navigation.js';
import { chargerTableau, chargerPings, ping, chargerGithub, chargerOffre, rendreTableau, rendreSite, rendreOffre,
  rendrePouls, rendreBonjour, rendreDirect, rendreAudits } from './tableau.js';
import { chargerClients, rendreClients, rendrePortail, ouvrirNouveau } from './clients.js';
import { fermerPanneau } from './panneau.js';
import { chargerCompte, chargerJournal, rendreCompte, viderCompte } from './compte.js';
import { chargerArgent, rendreArgent, viderArgent } from './argent.js';
import { preparerConnexion, demarrerConnexion } from './connexion.js';
import { installer, quandInstallChange } from './installer.js';

const CACHE_DEPUIS = 'uio-admin-cache-depuis';     // l'heure où l'admin est passé en arrière-plan
const INSTALLER_NON = 'uio-admin-installer-non';
let cacheDepuis = 0, majVerifiee = 0, veutRecharger = false, enregistrement = null;

// ─── Entrer et verrouiller ─────────────────────────────────────────────────
function entrer() {
  ecrire('sessionStorage', CACHE_DEPUIS, null);
  remettreAZero();
  $('#connexion').hidden = true;
  $('#appli').hidden = false;
  montrer(vueDuLien());
  rendreTout();
  chargerTout();
  planifier();
  // L'argent se lit un peu après l'entrée : le tableau de bord peut alors signaler une facture en retard ou un crédit bas
  E.minuteries.push(setTimeout(() => { if (sessionActuelle() && !E.argent) chargerArgent(); }, 1500));
  majBandeauInstaller();
  document.title = TITRE;
}

// Ferme tout : la page oublie la session, le serveur la ferme pour de bon, et
// plus rien de l'admin ne reste affiché derrière l'écran de connexion.
function verrouiller(message = '', { serveur = true, raison = '' } = {}) {
  const s = sessionActuelle();
  if (!s && !$('#connexion').hidden) return;
  const perdu = E.panneau && E.panneau.modifie && E.panneau.modifie();
  if (E.panneau) fermerPanneau(true);
  fermerAide();
  arreter();
  oublierSession();
  $('#toast').classList.remove('vu');
  if (serveur && s) fermerSession(s, raison);
  remettreAZero();
  rendreTout();
  $('#appli').hidden = true;
  $('#connexion').hidden = false;
  cacheDepuis = 0;
  ecrire('sessionStorage', CACHE_DEPUIS, null);
  document.title = TITRE;
  demarrerConnexion({ message: perdu ? `${message} Les changements en cours n’étaient pas enregistrés.`.trim() : message });
}
const verrouAuto = () => verrouiller('L’admin s’est verrouillé après 15 minutes en arrière-plan.', { raison: 'verrou' });

function remettreAZero() {
  Object.assign(E, { tableau: null, tableauErreur: '', majTableau: 0, clients: [], fonctionnalites: [], clientsErreur: '',
    clientsLus: false, recherche: '', neufs: new Map(), nonVus: 0 });
  $('#recherche').value = '';
  viderCompte();
  viderArgent();
}

function verifierExpiration() {
  const s = sessionActuelle();
  if (s && s.expire * 1000 - Date.now() < 30e3) verrouiller('Ta session de 12 heures est terminée. Reconnecte-toi.', { raison: 'verrou' });
}

// ─── Chargements et minuteries ─────────────────────────────────────────────
function rendreTout() { rendreTableau(); rendreSite(); rendreOffre(); rendreClients(); rendrePortail(); rendrePouls(); rendreArgent(); rendreCompte(); }

function chargerTout(frais = false) {
  const travaux = [chargerTableau(frais), chargerClients(), ping(), chargerGithub(frais), chargerOffre()];
  if (frais && E.vue === 'compte') travaux.push(chargerCompte(), chargerJournal());   // sinon : en ouvrant l'onglet
  if (E.vue === 'argent' || E.argent) travaux.push(chargerArgent({ frais }));
  return Promise.allSettled(travaux);
}

function planifier() {
  arreter();
  const boucle = (fn, ms) => E.minuteries.push(setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms));
  // Le tableau se relit aussi en arrière-plan (au plus toutes les 5 min) : le titre de l'onglet compte les nouveautés.
  E.minuteries.push(setInterval(() => {
    if (document.visibilityState === 'visible' || Date.now() - E.majTableau > 290e3) chargerTableau();
  }, DELAIS.tableau));
  boucle(() => chargerClients(true), DELAIS.clients);
  boucle(() => ping(), DELAIS.ping);
  boucle(() => chargerGithub(), DELAIS.github);
  boucle(() => chargerOffre(), DELAIS.offre);
  boucle(() => { rendreBonjour(); rendreDirect(); rendreAudits(); verifierExpiration(); verifierMaj(); }, DELAIS.horloge);
  boucle(() => { if (E.vue === 'compte') { chargerCompte(); chargerJournal(); } }, DELAIS.compte);
  boucle(() => { if (E.vue === 'argent') chargerArgent({ auto: true }); }, DELAIS.argent || 120e3);   // jamais pendant qu'on écrit
}
function arreter() { E.minuteries.forEach(clearInterval); E.minuteries = []; }

async function actualiser() {
  const b = $('#actualiser');
  b.classList.add('tourne');
  await chargerTout(true);
  b.classList.remove('tourne');
  if (Date.now() - (E.annonce || 0) > 2000) toast('Tout est à jour.');
}

quandVue('tableau', () => rendrePouls());
quandVue('compte', () => { rendreCompte(); chargerCompte(); chargerJournal(); });
quandVue('argent', () => { rendreArgent(); if (!E.argent || Date.now() - E.argentLu > 60e3) chargerArgent(); });

// ─── Arrière-plan : verrou après 15 minutes ────────────────────────────────
function revenir() {
  const depuis = cacheDepuis || Number(lire('sessionStorage', CACHE_DEPUIS) || 0);
  cacheDepuis = 0;
  ecrire('sessionStorage', CACHE_DEPUIS, null);
  if (!sessionActuelle()) return;
  if (depuis && Date.now() - depuis >= VERROU_APRES) return verrouAuto();
  verifierExpiration();
  if (!sessionActuelle()) return;
  if (E.nonVus) { E.nonVus = 0; document.title = TITRE; }
  if (Date.now() - E.majTableau > 60e3) chargerTout();
  verifierMaj();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (sessionActuelle()) { cacheDepuis = Date.now(); ecrire('sessionStorage', CACHE_DEPUIS, String(cacheDepuis)); }
    return;
  }
  revenir();
});
window.addEventListener('pageshow', e => { if (e.persisted) revenir(); });

// ─── Thème ─────────────────────────────────────────────────────────────────
function basculerTheme() {
  const sombre = document.documentElement.getAttribute('data-theme') !== 'sombre';
  if (sombre) document.documentElement.setAttribute('data-theme', 'sombre'); else document.documentElement.removeAttribute('data-theme');
  ecrire('localStorage', 'uio-theme', sombre ? 'sombre' : 'clair');
  majTheme();
}
function majTheme() {
  const sombre = document.documentElement.getAttribute('data-theme') === 'sombre';
  const b = $('#theme');
  b.setAttribute('aria-pressed', String(sombre));
  b.setAttribute('aria-label', sombre ? 'Mode clair (T)' : 'Mode sombre (T)');
  b.title = sombre ? 'Mode clair (T)' : 'Mode sombre (T)';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', sombre ? '#0E1420' : '#F4F5F8');
}

// ─── Aide clavier ──────────────────────────────────────────────────────────
let retourAide = null;
function ouvrirAide() { retourAide = document.activeElement; $('#aide').hidden = false; $('#aide-fermer').focus(); }
function fermerAide() {
  if ($('#aide').hidden) return;
  $('#aide').hidden = true;
  if (retourAide && document.contains(retourAide)) retourAide.focus();
}

document.addEventListener('keydown', e => {
  if (!sessionActuelle() || $('#appli').hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && E.panneau) { e.preventDefault(); if (E.panneau.enregistrer) E.panneau.enregistrer(); return; }
  if (e.key === 'Escape') {
    if (!$('#aide').hidden) fermerAide();
    else if (E.panneau && $('#panneau-pied').dataset.abandon) E.panneau.reprendre();
    else if (E.panneau) fermerPanneau();
    return;
  }
  if (!$('#aide').hidden && e.key === 'Tab') { e.preventDefault(); $('#aide-fermer').focus(); return; }
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || E.panneau || !$('#aide').hidden) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); montrer('clients'); $('#recherche').focus(); }
  else if (k === 'n' || k === 'N') { e.preventDefault(); montrer('clients'); ouvrirNouveau(); }
  else if (k === 'r' || k === 'R') { e.preventDefault(); actualiser(); }
  else if (k === 't' || k === 'T') basculerTheme();
  else if (k === 'l' || k === 'L') { e.preventDefault(); verrouiller(); }
  else if (['1', '2', '3', '4'].includes(k)) montrer(VUES[Number(k) - 1]);
  else if (k === '?') ouvrirAide();
});

// Onglets au clavier : flèches, Début et Fin
$('.onglets').addEventListener('keydown', e => {
  const i = VUES.indexOf(E.vue);
  const j = { ArrowRight: (i + 1) % VUES.length, ArrowLeft: (i - 1 + VUES.length) % VUES.length, Home: 0, End: VUES.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  montrer(VUES[j], true);
});

// ─── Installer l'app (bandeau sur téléphone) ───────────────────────────────
function majBandeauInstaller() {
  $('#bandeau-installer').hidden = estInstallee() || !estTelephone() || !!lire('localStorage', INSTALLER_NON);
}
quandInstallChange(majBandeauInstaller);
$('#bandeau-installer-oui').addEventListener('click', async () => {
  if (await installer()) return majBandeauInstaller();
  montrer('compte');
  requestAnimationFrame(() => { const c = $('#carte-appli'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
});
$('#bandeau-installer-non').addEventListener('click', () => { ecrire('localStorage', INSTALLER_NON, '1'); majBandeauInstaller(); });

// ─── Mises à jour de l'app ─────────────────────────────────────────────────
function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (veutRecharger) { veutRecharger = false; location.reload(); } });
  navigator.serviceWorker.register(adresseScript('sw.js'), { scope: './', updateViaCache: 'none' }).then(reg => {
    enregistrement = reg;
    majVerifiee = Date.now();
    if (reg.waiting && navigator.serviceWorker.controller) montrerMaj();
    reg.addEventListener('updatefound', () => {
      const neuf = reg.installing;
      if (!neuf) return;
      neuf.addEventListener('statechange', () => { if (neuf.state === 'installed' && navigator.serviceWorker.controller) montrerMaj(); });
    });
  }).catch(() => { /* sans service worker, l'admin marche quand même (sans hors-ligne) */ });
}
function verifierMaj() {
  if (!enregistrement || Date.now() - majVerifiee < 30 * 60e3) return;
  majVerifiee = Date.now();
  enregistrement.update().catch(() => {});
}
function montrerMaj() { $('#maj').hidden = false; }
$('#maj-oui').addEventListener('click', () => {
  if (E.panneau && E.panneau.modifie && E.panneau.modifie()) return toast('Enregistre d’abord ce qui est ouvert.', true);
  const attente = enregistrement && enregistrement.waiting;
  if (!attente) return location.reload();
  veutRecharger = true;
  attente.postMessage('passer');
});

// ─── Boutons de la page ────────────────────────────────────────────────────
$$('.onglets [role=tab]').forEach(b => b.addEventListener('click', () => montrer(b.dataset.vue)));
$$('[data-vers]').forEach(b => b.addEventListener('click', () => montrer(b.dataset.vers)));
$$('[data-actualiser]').forEach(b => b.addEventListener('click', actualiser));
$$('[data-aide]').forEach(b => b.addEventListener('click', ouvrirAide));
$('#actualiser').addEventListener('click', actualiser);
$('#theme').addEventListener('click', basculerTheme);
$('#verrouiller').addEventListener('click', () => verrouiller());
$('#aide-fermer').addEventListener('click', fermerAide);
$('#aide').addEventListener('click', e => { if (e.target === $('#aide')) fermerAide(); });
$('#voile').addEventListener('click', () => fermerPanneau());
$('#panneau-fermer').addEventListener('click', () => fermerPanneau());
$('#nouveau-client').addEventListener('click', ouvrirNouveau);
$('#recherche').addEventListener('input', e => { E.recherche = e.target.value; rendreClients(); });
$('#recherche').addEventListener('keydown', e => { if (e.key === 'Enter') { const premier = $('#clients-liste .client'); if (premier) premier.click(); } });
document.addEventListener('uio:reveil', () => { if (sessionActuelle()) chargerClients(); });
window.addEventListener('resize', () => { placerLentille(); if (sessionActuelle() && E.vue === 'tableau') rendrePouls(); });
window.addEventListener('beforeunload', e => { if (E.panneau && E.panneau.modifie && E.panneau.modifie()) { e.preventDefault(); e.returnValue = ''; } });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placerLentille);

// ─── Départ ────────────────────────────────────────────────────────────────
function demarrer() {
  ecrire('sessionStorage', 'uio-admin-cle', null);       // l'ancien mot de passe partagé (ancienne admin) : jamais gardé
  majTheme();
  chargerPings();
  preparerConnexion(entrer);
  quandSessionPerdue(message => verrouiller(message, { serveur: false }));
  const s = relireSession();
  const depuis = Number(lire('sessionStorage', CACHE_DEPUIS) || 0);
  if (s && depuis && Date.now() - depuis >= VERROU_APRES) verrouAuto();
  else if (s) entrer();
  else demarrerConnexion();
  enregistrerServiceWorker();
}

if (!document.documentElement.classList.contains('encadre')) demarrer();
