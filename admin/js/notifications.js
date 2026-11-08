// Notifications sur le téléphone (carte « Notifications » de l'onglet Compte) : les activer sur cet
// appareil, choisir ce qu'on reçoit (une tâche pour moi, une facture en retard, un crédit bas ou
// épuisé), s'envoyer un essai, et couper un autre appareil. Sur iPhone : seulement dans l'app
// installée sur l'écran d'accueil (iOS 16.4 ou plus). Le service worker montre l'avis (sw.js).
import { $, vider, icone, toast, relatif, date, estIOS, estAndroid, estInstallee } from './outils.js';
import { api, ErreurApi, sessionActuelle } from './api.js';
import { nomAppareil } from './appareil.js';
import { el, badge, rangee, bascule, confirmations } from './formes.js';
import { occuper } from './ui.js';

const DETAILS = {
  tache: 'Quand un associé, ou son Claude, t’en donne une.',
  facture: 'Plus de 7 jours après son échéance, une seule fois par facture.',
  credit: 'Retell, Twilio ou OpenAI : avant que les appels ou les chatbots s’arrêtent.'
};
const COURTS = { tache: 'tâches', facture: 'factures', credit: 'crédits' };
const SERVICES = { Apple: 'Apple', Google: 'Google', Mozilla: 'Mozilla', Microsoft: 'Microsoft' };

const etat = { donnees: null, erreur: '', lu: 0, ici: null, confirmer: '', occupe: false, repris: 0 };
const confirmer = confirmations(etat, () => rendreNotifications());

// ─── Ce que ce navigateur permet ───────────────────────────────────────────
export const notificationsPossibles = () => window.isSecureContext && 'serviceWorker' in navigator
  && 'PushManager' in window && 'Notification' in window;
const permission = () => ('Notification' in window ? Notification.permission : 'default');

const octets = t => {
  const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(t).length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
async function empreinte(adresse) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(adresse)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
// L'abonnement a-t-il été fait avec la clé actuelle du serveur ? (sinon, les envois seraient refusés)
function memeCle(abonnement, cle) {
  const k = abonnement && abonnement.options && abonnement.options.applicationServerKey;
  if (!k || !cle) return true;
  const a = new Uint8Array(k), b = octets(cle);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function enregistrement(delai = 4000) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), delai))]);
}
async function abonnementIci() {
  const reg = await enregistrement();
  return reg && reg.pushManager ? reg.pushManager.getSubscription().catch(() => null) : null;
}
async function lireIci() {
  if (!notificationsPossibles()) { etat.ici = { abonnement: null, empreinte: '', cleOk: true }; return; }
  const abonnement = await abonnementIci();
  etat.ici = { abonnement, empreinte: abonnement ? await empreinte(abonnement.endpoint) : '',
    cleOk: memeCle(abonnement, etat.donnees && etat.donnees.cle_publique) };
}

// ─── Lecture ───────────────────────────────────────────────────────────────
export async function chargerNotifications() {
  if (etat.occupe) return;
  try {
    etat.donnees = await api('/portal/admin/notifications');
    etat.erreur = '';
    etat.lu = Date.now();
    await lireIci();
    // En pause ici (nouveau mot de passe, « déconnecter partout ») alors qu'on y est connecté : il reprend
    const { ligne } = lignesIci();
    if (ligne && !ligne.recoit && permission() === 'granted' && Date.now() - etat.repris > 60e3) {
      etat.repris = Date.now();
      return reprendreNotifications();
    }
  } catch (e) {
    if (e.statut === 401) return;
    etat.erreur = e.statut === 404 ? 'Le serveur n’a pas encore les notifications : réessaie dans quelques minutes.' : e.message;
  }
  rendreNotifications();
}

export function viderNotifications() {
  Object.assign(etat, { donnees: null, erreur: '', lu: 0, ici: null, confirmer: '', occupe: false, repris: 0 });
  rendreNotifications();
}

// À chaque ouverture de l'app : redire au serveur l'abonnement de ce navigateur (après une reconnexion,
// ou si le navigateur a changé son adresse). Jamais d'abonnement neuf ici : seulement « Activer » en crée.
export async function reprendreNotifications() {
  try {
    if (!notificationsPossibles() || permission() !== 'granted' || !sessionActuelle()) return;
    const abonnement = await abonnementIci();
    if (!abonnement) return;
    const r = await api('/portal/admin/notifications/abonner', { methode: 'POST', corps: { abonnement: abonnement.toJSON(), garder: true } });
    etat.donnees = r; etat.lu = Date.now();
    await lireIci();
    rendreNotifications();
  } catch (e) { /* discret : la carte Notifications dira quoi faire */ }
}

// Une notification touchée pendant que l'app est ouverte : le service worker dit où aller
export function brancherNotifications(aller) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data;
    if (d && d.type === 'uio-aller' && /^#[a-z]{2,20}$/.test(d.lien || '')) aller(d.lien);
  });
}

// ─── Actions ───────────────────────────────────────────────────────────────
function messageErreur(e) {
  if (e instanceof ErreurApi) return e.message;
  if (e && e.name === 'NotAllowedError') return 'Le navigateur a refusé les notifications pour l’admin : permets-les dans ses réglages.';
  if (e && e.name === 'AbortError') return 'Le service de notifications de ce navigateur ne répond pas. Réessaie dans un instant.';
  return 'Les notifications n’ont pas pu s’activer. Réessaie dans un instant.';
}

async function activer(bouton) {
  if (!etat.donnees) return;
  const liberer = occuper(bouton, 'Activation…');
  etat.occupe = true;
  try {
    // La demande au navigateur part tout de suite, dans le geste (iPhone et Safari l'exigent)
    const choix = permission() === 'granted' ? 'granted' : await Notification.requestPermission();
    if (choix !== 'granted') {
      etat.occupe = false;
      liberer();
      toast(choix === 'denied' ? 'Notifications refusées : tu peux les permettre plus tard dans les réglages.' : 'Rien n’a changé : touche « Activer » pour recommencer.', choix === 'denied');
      return rendreNotifications();
    }
    const reg = await enregistrement(8000);
    if (!reg || !reg.pushManager) throw new Error('pas de service worker');
    let abonnement = await reg.pushManager.getSubscription();
    if (abonnement && !memeCle(abonnement, etat.donnees.cle_publique)) { await abonnement.unsubscribe().catch(() => {}); abonnement = null; }
    if (!abonnement) abonnement = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets(etat.donnees.cle_publique) });
    etat.donnees = await api('/portal/admin/notifications/abonner', { methode: 'POST',
      corps: { abonnement: abonnement.toJSON(), nom: nomAppareil() } });
    await lireIci();
    etat.occupe = false;
    rendreNotifications();
    toast('Notifications activées. Envoie-toi un essai pour voir.');
    const essai = document.querySelector('[data-focus="notif-essai"]');
    if (essai) essai.focus();
  } catch (e) {
    etat.occupe = false;
    liberer();
    if (e.statut !== 401) toast(messageErreur(e), true);
  }
}

async function couperIci(ligne) {
  await api('/portal/admin/notifications/retirer', { methode: 'POST', corps: { id: ligne.id } }).then(r => { etat.donnees = r; });
  const abonnement = await abonnementIci();
  if (abonnement) await abonnement.unsubscribe().catch(() => {});
  await lireIci();
  toast('Notifications coupées sur cet appareil.');
}

async function changerSorte(ligne, sorte, coche, input) {
  const voulues = new Set(ligne.sortes);
  if (coche) voulues.add(sorte); else voulues.delete(sorte);
  const sortes = etat.donnees.sortes.map(s => s.id).filter(id => voulues.has(id));
  input.disabled = true;
  etat.occupe = true;
  try {
    etat.donnees = await api('/portal/admin/notifications/sortes', { methode: 'POST', corps: { id: ligne.id, sortes } });
    etat.occupe = false;
    rendreNotifications();
    const meme = document.querySelector(`[data-focus="notif-${sorte}"]`);
    if (meme) meme.focus();
  } catch (e) {
    etat.occupe = false;
    input.checked = !coche;
    input.disabled = false;
    if (e.statut !== 401) toast(e.message, true);
  }
}

async function essayer(bouton, ligne) {
  const liberer = occuper(bouton, 'Envoi…');
  try {
    const r = await api('/portal/admin/notifications/essai', { methode: 'POST', corps: { id: ligne.id } });
    etat.donnees = r;
    liberer();
    toast(r.message || (r.ok ? 'Envoyée.' : 'L’essai n’est pas passé.'), !r.ok);
    if (r.statut === 404 || r.statut === 410) {          // son service de push l'a oublié : on repartira d'un abonnement neuf
      const abonnement = await abonnementIci();
      if (abonnement) await abonnement.unsubscribe().catch(() => {});
    }
    if (!r.ok) { await lireIci(); rendreNotifications(); }
  } catch (e) { liberer(); if (e.statut !== 401) toast(e.message, true); }
}

// ─── La carte ──────────────────────────────────────────────────────────────
const aideBloquees = () => {
  if (estIOS()) return 'Pour les permettre : Réglages de l’iPhone, Notifications, UIO Admin, puis « Autoriser les notifications ».';
  if (estAndroid()) {
    return estInstallee() ? 'Pour les permettre : touche longuement l’icône UIO Admin, « Infos sur l’appli », Notifications, puis Autoriser.'
      : 'Pour les permettre : le cadenas à gauche de l’adresse, Autorisations, Notifications, puis Autoriser.';
  }
  if (/Macintosh/.test(navigator.userAgent) && !/Chrome|Firefox|Edg\//.test(navigator.userAgent)) {
    return 'Pour les permettre : Safari, Réglages, Sites web, Notifications, puis « Autoriser » pour agenceuio.ca.';
  }
  return 'Pour les permettre : le cadenas à gauche de l’adresse, Notifications, puis Autoriser. Recharge ensuite la page.';
};

// La ligne de ce navigateur ; sinon, une ancienne ligne de cet appareil (abonnement perdu : à refaire)
function lignesIci() {
  const d = etat.donnees, ici = etat.ici;
  if (!d || !ici) return { ligne: null, ancienne: null };
  const ligne = ici.empreinte && ici.cleOk ? d.appareils.find(a => a.empreinte === ici.empreinte) || null : null;
  return { ligne, ancienne: ligne ? null : d.appareils.find(a => d.ici && a.appareil === d.ici) || null };
}

function blocIci() {
  const { ligne, ancienne } = lignesIci();
  const nom = nomAppareil();
  if (!notificationsPossibles()) {
    if (estIOS() && !estInstallee()) {
      return [rangee({ icon: 'i-cloche', titre: nom, badges: [badge('App à installer', 'attente')],
        meta: ['Sur iPhone, les notifications arrivent dans l’app installée sur l’écran d’accueil (iOS 16.4 ou plus). Installe-la, ouvre-la depuis son icône, puis reviens ici.'],
        action: el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => {
          const c = $('#carte-appli'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }, 'Comment l’installer') })];
    }
    return [rangee({ icon: 'i-cloche-barre', titre: nom, badges: [badge('Pas possible ici', 'neutre')],
      meta: [estIOS() ? 'Mets ton iPhone à jour (iOS 16.4 ou plus) pour recevoir les notifications dans l’app.'
        : 'Ce navigateur ne reçoit pas les notifications. Chrome, Edge, Firefox et Safari les reçoivent.'] })];
  }
  if (permission() === 'denied') {
    return [rangee({ icon: 'i-cloche-barre', titre: nom, badges: [badge('Bloquées', 'attente')],
      meta: ['Les notifications de l’admin sont bloquées dans les réglages de cet appareil.', aideBloquees()],
      action: el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => rendreNotifications() }, 'C’est fait') })];
  }
  if (!ligne || !ligne.recoit) {
    const pause = !!ligne, refaire = !ligne && !!ancienne;
    const bouton = el('button', { class: 'btn btn--petit', type: 'button', 'data-focus': 'notif-activer' }, icone('i-cloche'),
      pause ? 'Reprendre' : refaire ? 'Réactiver' : 'Activer');
    bouton.addEventListener('click', () => activer(bouton));
    return [rangee({ icon: 'i-cloche', titre: nom,
      badges: [pause ? badge('En pause', 'attente') : refaire ? badge('À réactiver', 'attente') : badge('Pas activées', 'neutre')],
      meta: [pause ? 'En pause depuis une déconnexion de tous les appareils ou un nouveau mot de passe.'
        : refaire ? 'Ce navigateur a oublié son abonnement aux notifications (données effacées, ou nouvelle clé du serveur) : touche « Réactiver ».'
          : 'Reçois ici les tâches pour toi, les factures en retard et les crédits bas, même quand l’admin est fermé.'],
      action: bouton })];
  }
  const blocs = [rangee({ icon: 'i-cloche', titre: nom, badges: [badge('Activées')],
    meta: [ligne.dernier_envoi ? `Dernier avis ${relatif(date(ligne.dernier_envoi))}` : 'Aucun avis reçu pour l’instant'],
    action: confirmer(`couper:${ligne.id}`, 'Couper ici', 'Couper les notifications sur cet appareil ?', () => couperIci(ligne)) })];
  const sortes = el('div', { class: 'notif__sortes', role: 'group', 'aria-label': 'Ce que tu reçois sur cet appareil' },
    etat.donnees.sortes.map(s => {
      const b = bascule(s.nom, DETAILS[s.id] || '', ligne.sortes.includes(s.id), coche => changerSorte(ligne, s.id, coche, b.input));
      b.input.setAttribute('data-focus', `notif-${s.id}`);
      return b.boite;
    }));
  const essai = el('button', { class: 'btn btn--contour btn--petit', type: 'button', 'data-focus': 'notif-essai' }, 'M’envoyer un essai');
  essai.addEventListener('click', () => essayer(essai, ligne));
  blocs.push(sortes, el('div', { class: 'carte__pied' }, essai),
    ligne.sortes.length ? null : el('p', { class: 'note' }, 'Rien n’est choisi : cet appareil ne recevra que les essais.'));
  return blocs;
}

function blocAutres() {
  const d = etat.donnees, { ligne, ancienne } = lignesIci();
  const autres = d.appareils.filter(a => a !== ligne && a !== ancienne);
  if (!autres.length) return [el('p', { class: 'vide' }, 'Aucun autre appareil. Ouvre l’admin sur ton téléphone (ou ton ordinateur) et touche « Activer » là-bas.')];
  return [el('div', { class: 'rangees' }, autres.map(a => rangee({
    icon: /iPhone|iPad|Android|Téléphone|Tablette/i.test(a.nom) ? 'i-telephone' : 'i-ordinateur', titre: a.nom || 'Appareil',
    badges: [a.recoit ? null : badge('En pause', 'attente')],
    meta: [a.recoit ? [SERVICES[a.service] || a.service, a.sortes.length ? `reçoit : ${a.sortes.map(s => COURTS[s] || s).join(', ')}` : 'ne reçoit que les essais'].filter(Boolean).join(' · ')
      : 'Reprend à la prochaine connexion sur cet appareil.',
    a.dernier_envoi ? `Dernier avis ${relatif(date(a.dernier_envoi))}` : ''],
    action: confirmer(`couper:${a.id}`, 'Couper', 'Couper les notifications sur cet appareil ?', async () => {
      etat.donnees = await api('/portal/admin/notifications/retirer', { methode: 'POST', corps: { id: a.id } });
      toast('Notifications coupées sur cet appareil.');
    })
  })))];
}

const ICONES_SORTES = { tache: 'i-equipe', facture: 'i-argent', credit: 'i-actualiser', essai: 'i-cloche' };
function blocDerniers() {
  const derniers = (etat.donnees.derniers || []).slice(0, 6);
  if (!derniers.length) return [el('p', { class: 'vide' }, 'Aucun avis pour l’instant.')];
  return [el('ul', { class: 'notif__derniers' }, derniers.map(a => {
    const d = date(a.quand);
    return el('li', null, el('span', { class: 'notif__puce', 'aria-hidden': 'true' }, icone(ICONES_SORTES[a.sorte] || 'i-cloche')),
      el('span', { class: 'notif__avis' }, el('span', null, a.titre), d ? el('time', { datetime: a.quand }, relatif(d)) : null));
  }))];
}

export function rendreNotifications() {
  const boite = $('#compte-notifications');
  if (!boite) return;
  if (etat.erreur && !etat.donnees) return vider(boite, el('p', { class: 'vide' }, etat.erreur));
  if (!etat.donnees || !etat.ici) return vider(boite, el('p', { class: 'vide' }, 'Lecture en cours…'));
  const focus = document.activeElement && boite.contains(document.activeElement) && document.activeElement.getAttribute('data-focus');
  vider(boite,
    el('div', { class: 'notif' },
      el('section', { class: 'notif__ici', 'aria-labelledby': 'notif-ici-t' },
        el('h3', { class: 'petit-titre', id: 'notif-ici-t' }, 'Sur cet appareil'), blocIci()),
      el('div', { class: 'notif__cote' },
        el('section', { 'aria-labelledby': 'notif-autres-t' }, el('h3', { class: 'petit-titre', id: 'notif-autres-t' }, 'Tes autres appareils'), blocAutres()),
        el('section', { 'aria-labelledby': 'notif-derniers-t' }, el('h3', { class: 'petit-titre', id: 'notif-derniers-t' }, 'Derniers avis'), blocDerniers()))),
    el('p', { class: 'note' }, 'Chaque avis est chiffré pour ton appareil : Apple ou Google le transportent sans pouvoir le lire. Verrouiller l’admin ne coupe pas les notifications ; « Déconnecter tous les autres appareils » ou un nouveau mot de passe les met en pause jusqu’à la prochaine connexion sur chacun.'));
  if (focus) { const n = boite.querySelector(`[data-focus="${CSS.escape(focus)}"]`); if (n) n.focus(); }
}
