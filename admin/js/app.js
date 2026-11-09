// Le chef d'orchestre : démarrage, entrée et verrouillage, minuteries, clavier,
// thème, bandeau « installer l'app » et mises à jour de l'app (service worker).
import { $, $$, lire, ecrire, toast, estInstallee, estTelephone } from './outils.js';
import { E, DELAIS, TITRE, VERROU_APRES } from './etat.js';
import { sessionActuelle, relireSession, oublierSession, quandSessionPerdue, fermerSession } from './api.js';
import { adresseScript } from './confiance.js';
import { ONGLETS, montrer, montrerPage, allerAuLien, placerLentille, quandVue, quandPage } from './navigation.js';
import { chargerTableau, chargerPings, ping, chargerGithub, chargerOffre, rendreTableau, rendreSite, rendreOffre,
  rendrePouls, rendreBonjour, rendreDirect, rendreAudits, brancherAFaire } from './tableau.js';
import { rendreAFaire } from './afaire.js';
import { chargerClients, rendreClients, rendrePortail, ouvrirNouveau } from './clients.js';
import { fermerPanneau } from './panneau.js';
import { chargerCompte, chargerJournal, rendreCompte, viderCompte } from './compte.js';
import { chargerArgent, rendreArgent, viderArgent } from './argent.js';
import { chargerEquipe, rendreEquipe, viderEquipe, rendreChrono, rendreClaude } from './equipe.js';
import { chargerProspects, viderProspects, rendreProspects, choisirSousVue, reprendreSousVue, sousVue, ouvrirNouveauProspect } from './prospects.js';
import { preparerConnexion, demarrerConnexion } from './connexion.js';
import { installer, quandInstallChange } from './installer.js';
import { ouvrirRecherche, viderRecherche, rechercheOuverte } from './recherche.js';
import { reprendreNotifications, brancherNotifications } from './notifications.js';

const CACHE_DEPUIS = 'uio-admin-cache-depuis';     // l'heure où l'admin est passé en arrière-plan
const INSTALLER_NON = 'uio-admin-installer-non';
let cacheDepuis = 0, majVerifiee = 0, veutRecharger = false, enregistrement = null;

// ─── Entrer et verrouiller ─────────────────────────────────────────────────
function entrer() {
  ecrire('sessionStorage', CACHE_DEPUIS, null);
  remettreAZero();
  $('#connexion').hidden = true;
  $('#appli').hidden = false;
  // Clients ou Prospects : celui d'avant (même onglet du navigateur), ou #prospects (raccourci de l'app)
  if (location.hash === '#prospects') choisirSousVue('prospects'); else reprendreSousVue();
  allerAuLien();
  rendreTout();
  chargerTout();
  planifier();
  // L'argent se lit un peu après l'entrée : le tableau de bord peut alors signaler une facture en retard ou un crédit bas
  E.minuteries.push(setTimeout(() => { if (sessionActuelle() && !E.argent) chargerArgent(); }, 1500));
  // L'équipe aussi : « 2 tâches pour toi » et le chrono qui tourne, dès le tableau de bord
  E.minuteries.push(setTimeout(() => { if (sessionActuelle() && !E.equipe) chargerEquipe(); }, 2500));
  // Les prospects : « 3 prospects à relancer » sur le tableau de bord
  E.minuteries.push(setTimeout(() => { if (sessionActuelle() && !E.prospects) chargerProspects(); }, 3500));
  // Les notifications : redire au serveur l'abonnement de cet appareil (il reprend après une reconnexion)
  E.minuteries.push(setTimeout(() => { if (sessionActuelle()) reprendreNotifications(); }, 4500));
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
const verrouAuto = () => verrouiller('Le CRM s’est verrouillé après 15 minutes en arrière-plan.', { raison: 'verrou' });

function remettreAZero() {
  Object.assign(E, { tableau: null, tableauErreur: '', majTableau: 0, clients: [], fonctionnalites: [], clientsErreur: '',
    clientsLus: false, fiches: null, fichesErreur: '', recherche: '', neufs: new Map(), nonVus: 0 });
  $('#recherche').value = '';
  viderRecherche();                                     // la recherche partout oublie tout, elle aussi
  viderCompte();
  viderArgent();
  viderEquipe();
  viderProspects();
}

function verifierExpiration() {
  const s = sessionActuelle();
  if (s && s.expire * 1000 - Date.now() < 30e3) verrouiller('Ta session de 12 heures est terminée. Reconnecte-toi.', { raison: 'verrou' });
}

// ─── Chargements et minuteries ─────────────────────────────────────────────
function rendreTout() { rendreTableau(); rendreSite(); rendreOffre(); rendreClients(); rendreProspects(); rendrePortail(); rendrePouls(); rendreArgent(); rendreEquipe(); rendreCompte(); }

// Les réglages ne se lisent que s'ils sont ouverts : le compte, et la page affichée (historique, système)
const surPage = page => E.vue === 'reglages' && E.page === page;
function chargerTout(frais = false) {
  const travaux = [chargerTableau(frais), chargerClients(), ping()];
  if (E.vue === 'reglages') travaux.push(chargerCompte());
  if (surPage('historique')) travaux.push(chargerJournal());
  if (surPage('systeme')) travaux.push(chargerGithub(frais), chargerOffre());
  if (E.vue === 'argent' || E.argent) travaux.push(chargerArgent({ frais }));
  if (E.vue === 'equipe' || E.equipe) travaux.push(chargerEquipe({ frais }));
  if ((E.vue === 'clients' && sousVue() === 'prospects') || E.prospects) travaux.push(chargerProspects({ frais }));
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
  boucle(() => { if (surPage('systeme')) chargerGithub(); }, DELAIS.github);
  boucle(() => { if (surPage('systeme')) chargerOffre(); }, DELAIS.offre);
  boucle(() => { rendreBonjour(); rendreDirect(); rendreAudits(); rendreChrono(); verifierExpiration(); verifierMaj(); }, DELAIS.horloge);
  boucle(() => { if (E.vue === 'reglages') chargerCompte(); if (surPage('historique')) chargerJournal(); }, DELAIS.compte);
  boucle(() => { if (E.vue === 'argent') chargerArgent({ auto: true }); }, DELAIS.argent || 120e3);   // jamais pendant qu'on écrit
  boucle(() => { if (E.vue === 'equipe') chargerEquipe({ auto: true }); }, DELAIS.equipe || 60e3);
  // « À faire aujourd'hui » reste juste : l'argent et l'équipe relus toutes les 5 min sur le tableau de bord
  boucle(() => {
    if (E.vue !== 'tableau') return;
    if (E.argent && Date.now() - E.argentLu > 5 * 60e3) chargerArgent({ auto: true });
    if (E.equipe && Date.now() - E.equipeLu > 5 * 60e3) chargerEquipe({ auto: true });
  }, 60e3);
  // Les prospects : relus souvent quand on les regarde, sinon toutes les 15 min (relances du tableau de bord)
  boucle(() => {
    if (E.prospectsErreur === 'pas-encore') return;                  // un serveur plus ancien : rien à relire
    if ((E.vue === 'clients' && sousVue() === 'prospects') || Date.now() - (E.prospectsLu || 0) > 15 * 60e3) chargerProspects({ auto: true });
  }, DELAIS.prospects || 90e3);
}
function arreter() { E.minuteries.forEach(clearInterval); E.minuteries = []; }

// Toucher « En direct » (ou la touche R) relit tout de suite
let actualisation = null;
function actualiser() {
  if (actualisation) return actualisation;
  const b = $('#direct');
  b.classList.add('tourne');
  actualisation = chargerTout(true).then(() => {
    b.classList.remove('tourne');
    actualisation = null;
    if (Date.now() - (E.annonce || 0) > 2000) toast('Tout est à jour.');
  });
  return actualisation;
}

quandVue('reglages', () => { rendreCompte(); chargerCompte(); });
quandPage('historique', () => chargerJournal());
quandPage('claude', () => { rendreClaude(); if (!E.equipe || Date.now() - E.equipeLu > 30e3) chargerEquipe(); });
quandPage('systeme', () => {
  rendrePouls(); rendreSite(); rendreOffre();
  chargerGithub();
  if (!E.offre || Date.now() - E.offre.lu > 10 * 60e3) chargerOffre();
});
quandVue('argent', () => { rendreArgent(); if (!E.argent || Date.now() - E.argentLu > 60e3) chargerArgent(); });
quandVue('equipe', () => { rendreEquipe(); if (!E.equipe || Date.now() - E.equipeLu > 30e3) chargerEquipe(); });
quandVue('clients', () => { rendreClients(); if (sousVue() === 'prospects' && (!E.prospects || Date.now() - (E.prospectsLu || 0) > 30e3)) chargerProspects(); });
// « À faire aujourd'hui » se redessine avec la phrase du tableau de bord (toutes les 15 s, et après chaque lecture)
brancherAFaire(rendreAFaire);

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
function basculerTheme() { choisirTheme(document.documentElement.getAttribute('data-theme') !== 'sombre'); }
function choisirTheme(sombre) {
  if (sombre) document.documentElement.setAttribute('data-theme', 'sombre'); else document.documentElement.removeAttribute('data-theme');
  ecrire('localStorage', 'uio-theme', sombre ? 'sombre' : 'clair');
  majTheme();
}
function majTheme() {
  const sombre = document.documentElement.getAttribute('data-theme') === 'sombre';
  $('#theme').checked = sombre;
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
  // ⌘K (Ctrl+K) : chercher partout, même depuis un champ ; jamais par-dessus un panneau ouvert
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    if (!E.panneau && $('#aide').hidden) { e.preventDefault(); ouvrirRecherche(); }
    return;
  }
  // ⌘, (Ctrl+,) : les réglages, comme dans les apps du Mac
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ',') {
    if (!E.panneau && $('#aide').hidden && !rechercheOuverte()) { e.preventDefault(); montrer('reglages'); }
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#aide').hidden) fermerAide();
    else if (E.panneau && $('#panneau-pied').dataset.abandon) E.panneau.reprendre();
    else if (E.panneau) fermerPanneau();
    else if (E.vue === 'reglages' && !rechercheOuverte() && !e.target.closest('input, textarea, select')) fermerReglages();
    return;
  }
  if (!$('#aide').hidden && e.key === 'Tab') { e.preventDefault(); $('#aide-fermer').focus(); return; }
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || E.panneau || !$('#aide').hidden || rechercheOuverte()) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); ouvrirRecherche(); }
  else if (k === 'n' || k === 'N') { e.preventDefault(); montrer('clients'); nouveau(); }
  else if (k === 'r' || k === 'R') { e.preventDefault(); actualiser(); }
  else if (k === 't' || k === 'T') basculerTheme();
  else if (k === 'l' || k === 'L') { e.preventDefault(); verrouiller(); }
  else if (['1', '2', '3', '4'].includes(k)) montrer(ONGLETS[Number(k) - 1]);
  else if (k === ',') { e.preventDefault(); montrer('reglages'); }
  else if (k === '?') ouvrirAide();
});

// Onglets au clavier : flèches, Début et Fin
$('.onglets').addEventListener('keydown', e => {
  const tab = e.target.closest('[role=tab]');
  const i = Math.max(0, ONGLETS.indexOf(tab ? tab.dataset.vue : E.vue)), n = ONGLETS.length;
  const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  montrer(ONGLETS[j], { focus: true });
});

// La roue ⚙ : ouvre les réglages ; touchée encore (ou Échap), elle ramène à l'onglet d'avant
function fermerReglages() { montrer(E.onglet || 'tableau'); const r = $('#reglages-ouvrir'); if (r) r.focus({ preventScroll: true }); }
$('#reglages-ouvrir').addEventListener('click', () => (E.vue === 'reglages' ? fermerReglages() : montrer('reglages')));
$$('.reglages__menu [data-page]').forEach(b => b.addEventListener('click', () => {
  montrerPage(b.dataset.page, true);
  const p = $('#reglages-' + b.dataset.page);
  // Sur téléphone, le menu est au-dessus : la page choisie vient sous les yeux
  if (p && p.getBoundingClientRect().top > window.innerHeight * .6) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// ─── Installer l'app (bandeau sur téléphone) ───────────────────────────────
function majBandeauInstaller() {
  $('#bandeau-installer').hidden = estInstallee() || !estTelephone() || !!lire('localStorage', INSTALLER_NON);
}
quandInstallChange(majBandeauInstaller);
$('#bandeau-installer-oui').addEventListener('click', async () => {
  if (await installer()) return majBandeauInstaller();
  montrer('reglages', { page: 'affichage' });
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
$('#direct').addEventListener('click', () => actualiser());
if ($('#chercher-ouvrir')) $('#chercher-ouvrir').addEventListener('click', () => ouvrirRecherche());
$('#theme').addEventListener('change', e => choisirTheme(e.target.checked));
$('#verrouiller').addEventListener('click', () => verrouiller());
$('#aide-fermer').addEventListener('click', fermerAide);
$('#aide').addEventListener('click', e => { if (e.target === $('#aide')) fermerAide(); });
$('#voile').addEventListener('click', () => fermerPanneau());
$('#panneau-fermer').addEventListener('click', () => fermerPanneau());
// Clients ou Prospects : le bouton « Nouveau », la recherche et Entrée suivent ce qui est affiché
const nouveau = () => (sousVue() === 'prospects' ? ouvrirNouveauProspect() : ouvrirNouveau());
$('#nouveau-client').addEventListener('click', () => nouveau());
$('#voir-clients').addEventListener('click', () => choisirSousVue('clients'));
$('#voir-prospects').addEventListener('click', () => choisirSousVue('prospects'));
$('#recherche').addEventListener('input', e => {
  if (sousVue() === 'prospects') { E.rechercheProspects = e.target.value; rendreProspects(); }
  else { E.recherche = e.target.value; rendreClients(); }
});
$('#recherche').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const premier = $(sousVue() === 'prospects' ? '#prospects .prospect__corps' : '#clients-liste .client');
  if (premier) premier.click();
});
document.addEventListener('uio:reveil', () => { if (sessionActuelle()) chargerClients(); });
window.addEventListener('resize', () => { placerLentille(); if (sessionActuelle() && surPage('systeme')) rendrePouls(); });
window.addEventListener('beforeunload', e => { if (E.panneau && E.panneau.modifie && E.panneau.modifie()) { e.preventDefault(); e.returnValue = ''; } });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placerLentille);

// ─── Départ ────────────────────────────────────────────────────────────────
function demarrer() {
  ecrire('sessionStorage', 'uio-admin-cle', null);       // l'ancien mot de passe partagé (ancienne admin) : jamais gardé
  majTheme();
  chargerPings();
  preparerConnexion(entrer);
  quandSessionPerdue(message => verrouiller(message, { serveur: false }));
  // Une notification touchée : l'onglet qu'elle concerne (après l'écran de connexion si le CRM est verrouillé)
  brancherNotifications(lien => {
    if (history.replaceState) history.replaceState(null, '', lien);
    if (!sessionActuelle() || $('#appli').hidden) return;
    if (lien === '#prospects') choisirSousVue('prospects');
    allerAuLien();
  });
  const s = relireSession();
  const depuis = Number(lire('sessionStorage', CACHE_DEPUIS) || 0);
  if (s && depuis && Date.now() - depuis >= VERROU_APRES) verrouAuto();
  else if (s) entrer();
  else demarrerConnexion();
  enregistrerServiceWorker();
}

if (!document.documentElement.classList.contains('encadre')) demarrer();
