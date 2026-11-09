// L'entrée du CRM. D'abord Face ID (ou l'empreinte) sur un appareil déjà connu,
// sinon l'identifiant, le mot de passe, puis le code de vérification à 6 chiffres.
// Ici aussi : créer le premier compte, accepter une invitation, ajouter le code,
// proposer Face ID après la connexion, et le dépannage (compte perdu ou bloqué).
import { $, el, icone, vider, lire, ecrire, date, heure, jourLong, majuscule, normal,
  estTelephone, estIOS, estAndroid, biometrie, copier, toast } from './outils.js';
import { api, ErreurApi, retenirSession } from './api.js';
import { appareil, nomAppareil } from './appareil.js';
import { clesPossibles, biometrieDispo, preparer, signer, creer, messageCle } from './cles.js';
import { qrSvg } from './qr.js';
import { prenom, salutation } from './tableau.js';
import { titre, phrase, erreurZone, champ, identifiantCache, champMotDePasse, champCode, occuper, progression, depliant } from './ui.js';

const CLE_ICI = 'uio-admin-cle-ici';           // une clé d'accès existe sur cet appareil : { identifiant, id }
const PLUS_TARD = 'uio-admin-cle-plus-tard';   // « Plus tard » : Face ID n'est pas reproposé avant 7 jours
const IDENTIFIANT = 'uio-admin-identifiant';
const PRENOM = 'uio-admin-prenom';
const IDENTIFIANT_RE = /^[a-z][a-z0-9._-]{1,29}$/;

let entrer = () => {};
let etat = null;                 // { premier_compte, cles_dispo } : lu une fois au démarrage
let invitation = null;           // le code du lien d'invitation, retiré de l'adresse dès l'arrivée
let generation = 0;              // change à chaque écran : une réponse en retard n'agit plus
let defi = null, minuterieDefi = 0;

export const preparerConnexion = fn => { entrer = fn; };

// ─── Ce que l'appareil retient (jamais de secret) ──────────────────────────
export function cleIci() {
  try { const c = JSON.parse(lire('localStorage', CLE_ICI) || 'null'); return c && c.identifiant ? c : null; } catch (e) { return null; }
}
export const retenirCleIci = (identifiant, id = '') => ecrire('localStorage', CLE_ICI, JSON.stringify({ identifiant, id }));
export const oublierCleIci = () => ecrire('localStorage', CLE_ICI, null);
const plusTardRecent = () => Date.now() - Number(lire('localStorage', PLUS_TARD) || 0) < 7 * 864e5;

// ─── Affichage d'un écran ──────────────────────────────────────────────────
function afficher(...enfants) {
  generation++;
  arreterDefi();
  const ecran = $('#ecran');
  vider(ecran, enfants);
  ecran.classList.remove('entre');
  void ecran.offsetWidth;                       // relance l'animation d'entrée
  ecran.classList.add('entre');
  const cible = ecran.querySelector('[data-focus]') || ecran.querySelector('h1');
  if (cible) cible.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
const chargement = texte => el('div', { class: 'chargement' }, el('span', { class: 'roue', 'aria-hidden': 'true' }), el('p', { role: 'status' }, texte));
const liens = (...boutons) => el('div', { class: 'ecran__liens' }, ...boutons);
const lien = (texte, action) => el('button', { class: 'lien', type: 'button', onclick: action }, texte);
// Sur un téléphone, on ne fait pas surgir le clavier tout seul (sauf pour le code)
const focusSiOrdinateur = champ => { if (!estTelephone()) champ.setAttribute('data-focus', ''); };
const quand = iso => { const d = date(iso); return d ? `${jourLong(d)} à ${heure(d)}` : ''; };

function phraseBio() {
  const b = biometrie();
  if (estIOS()) return 'La prochaine fois, un regard suffit pour ouvrir le CRM. Ton visage ne quitte jamais ton appareil : le serveur ne reçoit qu’une clé publique, inutile à quelqu’un d’autre.';
  if (estAndroid()) return 'La prochaine fois, ton doigt suffit pour ouvrir le CRM. Ton empreinte ne quitte jamais ton téléphone : le serveur ne reçoit qu’une clé publique, inutile à quelqu’un d’autre.';
  return `La prochaine fois, ${b.nom} suffit pour ouvrir le CRM. Rien ne quitte ton appareil : le serveur ne reçoit qu’une clé publique, inutile à quelqu’un d’autre.`;
}

// ─── Départ ────────────────────────────────────────────────────────────────
function lireInvitation() {
  const m = /^#invitation=([A-Za-z0-9_-]{16,100})$/.exec(location.hash);
  if (m) {
    invitation = m[1];
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);   // le code ne reste pas dans l'adresse
  }
  return invitation;
}

export async function demarrerConnexion({ message = '' } = {}) {
  lireInvitation();
  if (!etat) {
    afficher(chargement('Ouverture du CRM…'));
    const ici = generation;
    const lent = setTimeout(() => { if (ici === generation) afficher(chargement('Le serveur se réveille. Ça peut prendre jusqu’à une minute…')); }, 4000);
    try {
      etat = await api('/portal/admin/compte/etat', { auth: false, delai: 90000 });
    } catch (e) {
      clearTimeout(lent);
      return ecranPanne(e);
    }
    clearTimeout(lent);
  }
  if (invitation) return ecranInvitation(invitation);
  if (etat.premier_compte) return ecranPremierCompte();
  return ecranConnexion({ message });
}

function ecranPanne(e) {
  const pasEncore = e.statut === 404;
  const reessayer = el('button', { class: 'btn btn--plein', type: 'button', 'data-focus': '', onclick: () => demarrerConnexion() }, 'Réessayer');
  afficher(titre(pasEncore ? 'Presque prêt' : 'Le serveur ne répond pas'),
    phrase(pasEncore
      ? 'Le serveur n’a pas encore reçu la mise à jour des comptes du CRM. Elle arrive avec la prochaine mise en ligne du serveur.'
      : e.message),
    reessayer);
}

// ─── Connexion ─────────────────────────────────────────────────────────────
export function ecranConnexion({ message = '' } = {}) {
  const nom = lire('localStorage', PRENOM) || '';
  const ici = cleIci();
  const avecCle = clesPossibles() && etat && etat.cles_dispo;
  const bio = biometrie();
  const erreur = erreurZone(message);

  const identifiant = champ({ etiquette: 'Identifiant', type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none',
    autocorrect: 'off', spellcheck: 'false', required: true, maxlength: 30, enterkeyhint: 'next', value: lire('localStorage', IDENTIFIANT) || '' });
  const mdp = champMotDePasse({ etiquette: 'Mot de passe', autocomplete: 'current-password' });
  const continuer = el('button', { class: avecCle && ici ? 'btn btn--contour btn--plein' : 'btn btn--plein', type: 'submit' }, 'Continuer');
  const form = el('form', { novalidate: true }, identifiant.boite, mdp.boite, continuer);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    const id = identifiant.input.value.trim().toLowerCase(), m = mdp.valeur();
    if (!id) { erreur.textContent = 'Écris ton identifiant.'; return identifiant.input.focus(); }
    if (!m) { erreur.textContent = 'Écris ton mot de passe.'; return mdp.input.focus(); }
    const liberer = occuper(continuer, 'Vérification…');
    try {
      const r = await api('/portal/admin/connexion', { methode: 'POST', auth: false, delai: 90000,
        corps: { identifiant: id, mot_de_passe: m, appareil: appareil() } });
      ecrire('localStorage', IDENTIFIANT, id);
      if (r.etape === 'code_a_ajouter') return ecranAjoutCode(r);
      ecranCode({ jeton: r.jeton, identifiant: id });
    } catch (e) {
      liberer();
      erreur.textContent = e.message;
      if (e.statut === 401) mdp.input.select();
    }
  });

  const blocs = [titre(nom ? salutation()(nom) : 'CRM d’Agence UIO'),
    phrase(nom ? 'Le CRM de l’agence, rien que pour l’équipe.' : 'Les clients, l’argent et l’équipe de l’agence, réservés à l’équipe.'), erreur];
  if (avecCle) {
    const boutonCle = el('button', { class: ici ? 'btn btn--plein' : 'btn btn--contour btn--plein', type: 'button' },
      icone(ici ? bio.icone : 'i-cle'), ici ? `Entrer avec ${bio.nom}` : 'Entrer avec une clé d’accès');
    boutonCle.addEventListener('click', () => entrerAvecCle(boutonCle, erreur, () => { form.hidden = false; autre.hidden = true; }));
    const autre = lien('Utiliser mon mot de passe', () => { form.hidden = false; autre.hidden = true; identifiant.input.value ? mdp.input.focus() : identifiant.input.focus(); });
    if (ici) {
      if (!estTelephone()) boutonCle.setAttribute('data-focus', '');
      form.hidden = true;
      blocs.push(boutonCle, el('div', { class: 'ecran__liens' }, autre), form);
    } else {
      autre.hidden = true;
      focusSiOrdinateur(identifiant.input.value ? mdp.input : identifiant.input);
      blocs.push(form, el('div', { class: 'ou' }, 'ou'), boutonCle);
    }
  } else {
    focusSiOrdinateur(identifiant.input.value ? mdp.input : identifiant.input);
    blocs.push(form);
  }
  blocs.push(liens(
    nom ? lien('Pas toi ?', () => { ecrire('localStorage', PRENOM, null); ecrire('localStorage', IDENTIFIANT, null); oublierCleIci(); ecranConnexion(); }) : null,
    lien('Problème pour entrer ?', ecranDepannage)));
  afficher(...blocs);
  if (avecCle) preparerDefi();
}

// Le défi de Face ID est demandé AVANT le toucher : Safari exige que Face ID
// s'ouvre tout de suite après le geste. Il vaut 5 minutes ; on le renouvelle à 4.
function preparerDefi() {
  const ici = generation;
  clearTimeout(minuterieDefi);
  return preparer('connexion').then(d => {
    if (ici !== generation) return;
    defi = d;
    minuterieDefi = setTimeout(preparerDefi, 4 * 60e3);
  }).catch(() => { if (ici === generation) defi = null; });
}
function arreterDefi() { clearTimeout(minuterieDefi); defi = null; }

async function entrerAvecCle(bouton, erreur, montrerFormulaire) {
  erreur.textContent = '';
  if (!defi) {
    const liberer = occuper(bouton, 'Un instant…');
    await preparerDefi();
    liberer();
    erreur.textContent = defi ? 'C’est prêt : touche le bouton encore une fois.' : 'Le serveur ne répond pas pour le moment. Utilise ton mot de passe, ou réessaie dans une minute.';
    if (!defi) montrerFormulaire();
    return;
  }
  const d = defi;
  defi = null;
  const ici = generation;
  const liberer = occuper(bouton, 'Vérification…');
  try {
    const reponse = await signer(d);
    const s = await api('/portal/admin/cle/connexion', { methode: 'POST', auth: false, delai: 90000,
      corps: { defi: d.defi, reponse, appareil: appareil() } });
    if (ici !== generation) return;
    retenirCleIci(s.admin.identifiant, reponse.id);
    await apresConnexion(s, { cle: true });
  } catch (e) {
    if (ici !== generation) return;
    liberer();
    if (e.code === 'cle_inconnue') oublierCleIci();
    const m = e instanceof ErreurApi ? e.message : messageCle(e, biometrie().nom);
    if (m) { erreur.textContent = m; montrerFormulaire(); }
    preparerDefi();
  }
}

function ecranCode({ jeton, identifiant }) {
  const erreur = erreurZone();
  const valider = el('button', { class: 'btn btn--plein', type: 'submit' }, 'Valider');
  let envoi = false;
  const code = champCode({ surComplet: () => form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })) });
  code.input.setAttribute('data-focus', '');
  const form = el('form', { novalidate: true }, identifiantCache(identifiant), code.boite, valider);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (envoi) return;
    const c = code.valeur();
    if (c.length !== 6) { erreur.textContent = 'Le code a 6 chiffres.'; return code.input.focus(); }
    envoi = true;
    erreur.textContent = '';
    const liberer = occuper(valider, 'Vérification…');
    try {
      const s = await api('/portal/admin/connexion/code', { methode: 'POST', auth: false, delai: 90000,
        corps: { jeton, code: c, appareil: appareil() } });
      await apresConnexion(s);
    } catch (e) {
      envoi = false;
      liberer();
      if (e.code === 'expire') return ecranConnexion({ message: e.message });
      erreur.textContent = e.message;
      code.vider();
      code.input.focus();
    }
  });
  afficher(titre('Ton code de vérification'),
    phrase('Ouvre ton appli de codes (Mots de passe sur iPhone, Google Authenticator sur Android) et entre les 6 chiffres d’', el('b', null, 'Agence UIO'), '.'),
    erreur, form, liens(lien('Retour', () => ecranConnexion())));
}

// Après la connexion : on retient le prénom (pour dire bonjour), puis Face ID est proposé
// une fois si l'appareil le permet et qu'il n'a pas encore de clé.
async function apresConnexion(s, { cle = false, inscription = false } = {}) {
  retenirSession(s);
  ecrire('localStorage', IDENTIFIANT, s.admin.identifiant);
  ecrire('localStorage', PRENOM, prenom(s.admin.nom));
  if (!cle && etat && etat.cles_dispo && clesPossibles()) {
    const ici = cleIci();
    const dejaIci = ici && ici.identifiant === s.admin.identifiant;
    if (!dejaIci && (inscription || !plusTardRecent()) && await biometrieDispo()) return ecranProposerCle(s, { inscription });
  }
  arreterDefi();
  entrer(s);
}

function ecranProposerCle(s, { inscription = false } = {}) {
  const bio = biometrie();
  const erreur = erreurZone();
  let options = null;
  const prechargerOptions = () => preparer('inscription').then(o => { options = o; }).catch(() => { options = null; });
  const activer = el('button', { class: 'btn btn--plein', type: 'button', 'data-focus': '' }, icone(bio.icone), `Activer ${bio.nom}`);
  activer.addEventListener('click', async () => {
    erreur.textContent = '';
    if (!options) {
      const liberer = occuper(activer, 'Un instant…');
      await prechargerOptions();
      liberer();
      erreur.textContent = options ? 'C’est prêt : touche le bouton encore une fois.' : 'Le serveur ne répond pas. Tu pourras l’activer plus tard dans Compte.';
      return;
    }
    const o = options;
    options = null;
    const liberer = occuper(activer, 'Création de la clé…');
    try {
      const reponse = await creer(o);
      await api('/portal/admin/cle/inscrire', { methode: 'POST', delai: 90000, corps: { defi: o.defi, reponse, nom: nomAppareil() } });
      retenirCleIci(s.admin.identifiant, reponse.id);
      ecrire('localStorage', PLUS_TARD, null);
      toast(`${majuscule(bio.nom)} est activé${bio.e} sur cet appareil.`);
      entrer(s);
    } catch (e) {
      liberer();
      if (e && e.name === 'InvalidStateError') { retenirCleIci(s.admin.identifiant); toast('Cet appareil avait déjà sa clé d’accès.'); return entrer(s); }
      const m = e instanceof ErreurApi ? e.message : messageCle(e, bio.nom);
      if (m) erreur.textContent = m;
      prechargerOptions();
    }
  });
  const plusTard = lien('Plus tard', () => { ecrire('localStorage', PLUS_TARD, String(Date.now())); entrer(s); });
  afficher(inscription ? progression(3, majuscule(bio.nom)) : null,
    el('div', { class: 'grand-icone' }, icone(bio.icone)),
    titre(`Entrer avec ${bio.nom}`), phrase(phraseBio()), erreur, activer, liens(plusTard));
  prechargerOptions();
}

// ─── Premier compte (une seule fois, avec l'ancien mot de passe de l'admin) ─
const versIdentifiant = p => normal(p).replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 30);

function ecranPremierCompte() {
  const erreur = erreurZone();
  const prenomC = champ({ etiquette: 'Ton prénom', type: 'text', autocomplete: 'given-name', required: true, maxlength: 40, enterkeyhint: 'next' });
  const ident = champ({ etiquette: 'Identifiant', aide: 'Lettres minuscules et chiffres, sans espace. Tu l’écriras pour te connecter.',
    type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true, maxlength: 30 });
  const contexte = () => ({ prenom: prenomC.input.value, identifiant: ident.input.value });
  const mdp = champMotDePasse({ etiquette: 'Ton mot de passe', autocomplete: 'new-password', regles: true, contexte });
  const ancien = champMotDePasse({ etiquette: 'Ancien mot de passe du CRM', autocomplete: 'off',
    aide: 'Celui que l’équipe utilisait jusqu’ici. Il sert une dernière fois, pour prouver que c’est toi.' });
  let identTouche = false;
  prenomC.input.addEventListener('input', () => { if (!identTouche) ident.input.value = versIdentifiant(prenomC.input.value); mdp.verifier(); });
  ident.input.addEventListener('input', () => { identTouche = true; mdp.verifier(); });
  focusSiOrdinateur(prenomC.input);
  const creerBtn = el('button', { class: 'btn btn--plein', type: 'submit' }, 'Continuer');
  const form = el('form', { novalidate: true }, prenomC.boite, ident.boite, mdp.boite, ancien.boite, creerBtn);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    const nom = prenomC.input.value.trim(), id = ident.input.value.trim().toLowerCase();
    if (!nom) { erreur.textContent = 'Écris ton prénom.'; return prenomC.input.focus(); }
    if (!IDENTIFIANT_RE.test(id)) { erreur.textContent = 'Identifiant : lettres minuscules et chiffres, de 2 à 30 caractères, en commençant par une lettre.'; return ident.input.focus(); }
    if (!mdp.valide()) { erreur.textContent = 'Le mot de passe ne suit pas encore les règles sous le champ.'; return mdp.input.focus(); }
    if (!ancien.valeur()) { erreur.textContent = 'Écris l’ancien mot de passe du CRM.'; return ancien.input.focus(); }
    const liberer = occuper(creerBtn, 'Création du compte…');
    try {
      const r = await api('/portal/admin/compte/creer', { methode: 'POST', auth: false, delai: 90000,
        corps: { nom, identifiant: id, mot_de_passe: mdp.valeur(), ancien_mot_de_passe: ancien.valeur(), appareil: appareil() } });
      ecrire('localStorage', IDENTIFIANT, id);
      ecranAjoutCode(r, { inscription: true });
    } catch (e) { liberer(); erreur.textContent = e.message; }
  });
  afficher(progression(1, 'Ton compte'), titre('Créer ton compte'),
    phrase('Le CRM passe aux comptes personnels : chacun a le sien, avec un mot de passe, un code de vérification et Face ID ou l’empreinte. Ensuite, tu pourras inviter le reste de l’équipe.'),
    erreur, form);
}

// ─── Invitation (lien de 48 h, une seule fois) ────────────────────────────
async function ecranInvitation(code) {
  afficher(chargement('Lecture de l’invitation…'));
  const ici = generation;
  let inv;
  try {
    inv = await api('/portal/admin/invitation/voir', { methode: 'POST', auth: false, delai: 90000, corps: { invitation: code } });
  } catch (e) {
    if (ici !== generation) return;
    if (e.code !== 'invitation') return ecranPanne(e);
    invitation = null;
    return afficher(titre('Ce lien ne marche plus'), phrase(e.message),
      el('button', { class: 'btn btn--plein', type: 'button', 'data-focus': '', onclick: () => demarrerConnexion() }, 'Aller à la connexion'));
  }
  if (ici !== generation) return;
  const erreur = erreurZone();
  const prenomC = champ({ etiquette: 'Ton prénom', type: 'text', autocomplete: 'given-name', required: true, maxlength: 40, value: inv.nom || '' });
  const mdp = champMotDePasse({ etiquette: 'Choisis ton mot de passe', autocomplete: 'new-password', regles: true,
    contexte: () => ({ prenom: prenomC.input.value, identifiant: inv.identifiant }) });
  focusSiOrdinateur(mdp.input);
  const creerBtn = el('button', { class: 'btn btn--plein', type: 'submit' }, 'Continuer');
  const form = el('form', { novalidate: true }, identifiantCache(inv.identifiant), prenomC.boite, mdp.boite, creerBtn);
  prenomC.input.addEventListener('input', () => mdp.verifier());
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    if (!prenomC.input.value.trim()) { erreur.textContent = 'Écris ton prénom.'; return prenomC.input.focus(); }
    if (!mdp.valide()) { erreur.textContent = 'Le mot de passe ne suit pas encore les règles sous le champ.'; return mdp.input.focus(); }
    const liberer = occuper(creerBtn, 'Création du compte…');
    try {
      const r = await api('/portal/admin/compte/creer', { methode: 'POST', auth: false, delai: 90000,
        corps: { invitation: code, nom: prenomC.input.value.trim(), mot_de_passe: mdp.valeur(), appareil: appareil() } });
      invitation = null;
      ecrire('localStorage', IDENTIFIANT, r.identifiant);
      ecranAjoutCode(r, { inscription: true });
    } catch (e) {
      liberer();
      erreur.textContent = e.message;
      if (e.code === 'invitation') invitation = null;
    }
  });
  const par = inv.par ? prenom(inv.par) : '';
  afficher(progression(1, 'Ton compte'), titre(`Bienvenue, ${prenom(inv.nom) || inv.identifiant}.`),
    phrase(par ? `${par} t’a ouvert un compte dans le CRM d’Agence UIO.` : 'Un compte t’attend dans le CRM d’Agence UIO.'),
    el('div', { class: 'info' }, el('span', null, 'Ton identifiant : ', el('b', null, inv.identifiant), '. Tu l’écriras pour te connecter.'),
      inv.expire ? el('span', null, `Ce lien marche jusqu’au ${quand(inv.expire)}, une seule fois.`) : null),
    erreur, form);
}

// ─── Ajouter le code de vérification (appli de codes) ─────────────────────
// Android : le lien otpauth:// tout court, ou l'appareil photo, peut ouvrir une autre appli
// (Samsung Pass sur un Samsung) qui ne garde pas le code. On vise Google Authenticator ; s'il
// n'est pas installé, Android ouvre sa page du Play Store (et l'admin reste dans son onglet).
const PAQUET_GA = 'com.google.android.apps.authenticator2';
const PLAY_GA = `https://play.google.com/store/apps/details?id=${PAQUET_GA}`;
const lienGoogleAuthenticator = otpauth => `intent://${String(otpauth).replace(/^otpauth:\/\//, '')}#Intent;scheme=otpauth;package=${PAQUET_GA};end`;

function ecranAjoutCode(ins, { inscription = false } = {}) {
  const erreur = erreurZone();
  const groupes = String(ins.secret || '').replace(/(.{4})/g, '$1 ').trim();
  const blocSecret = [
    el('p', { class: 'note' }, 'Dans ton appli de codes, choisis « saisir une clé » et colle celle-ci. Type : basé sur l’heure, 6 chiffres, 30 secondes.'),
    el('div', { class: 'secret', 'aria-label': 'Clé secrète du code' }, groupes),
    el('button', { class: 'btn btn--contour btn--petit debut', type: 'button',
      onclick: async () => toast(await copier(ins.secret) ? 'Clé copiée.' : 'Copie impossible : sélectionne la clé à la main.', false) }, icone('i-copier'), 'Copier la clé')
  ];
  const blocQr = [el('div', { class: 'qr' }, qrSvg(ins.otpauth)),
    el('p', { class: 'note' }, 'Sur iPhone : l’appareil photo (le code va dans Mots de passe). Sur Android : dans Google Authenticator, « + » puis « Scanner un code QR », pas l’appareil photo (sur un Samsung, il ouvre Samsung Pass, qui ne garde pas ce code).')];
  const ajout = [];
  if (estTelephone() && estAndroid()) {
    ajout.push(
      el('ol', { class: 'etapes-installer etapes-code' },
        el('li', null, el('div', null, el('p', null, 'Installe ', el('b', null, 'Google Authenticator'), ' (gratuit, fait par Google), si ce n’est pas déjà fait.'),
          el('a', { class: 'btn btn--contour btn--petit', href: PLAY_GA, target: '_blank', rel: 'noopener' }, 'Ouvrir le Play Store'))),
        el('li', null, el('div', null, el('p', null, 'Ajoute le code d’Agence UIO à Google Authenticator :'),
          el('a', { class: 'btn btn--sombre btn--plein', href: lienGoogleAuthenticator(ins.otpauth) }, icone('i-plus-carre'), 'Ajouter à Google Authenticator'))),
        el('li', null, el('div', null, el('p', null, 'Reviens ici et entre les 6 chiffres affichés.')))),
      el('p', { class: 'note' }, 'Le bouton ne marche pas ? Dans Google Authenticator, touche « + », puis « Saisir une clé de configuration ». Nom : Agence UIO. Colle cette clé, type : basé sur l’heure.'),
      blocSecret[1], blocSecret[2],
      depliant('L’appli ne s’ouvre pas, ou le code va sur un autre appareil ?', ...blocQr));
  } else if (estTelephone()) {
    ajout.push(el('a', { class: 'btn btn--sombre btn--plein', href: ins.otpauth }, icone('i-plus-carre'), 'Ajouter à mon appli de codes'),
      el('p', { class: 'note' }, estIOS()
        ? 'L’app Mots de passe de l’iPhone s’ouvre et garde le code. Reviens ensuite ici avec les 6 chiffres.'
        : estAndroid()
          ? 'Google Authenticator s’ouvre et garde le code (installe-le depuis le Play Store au besoin). Reviens ensuite ici avec les 6 chiffres.'
          : 'Ton appli de codes s’ouvre et garde le code. Reviens ensuite ici avec les 6 chiffres.'),
      depliant('L’appli ne s’ouvre pas, ou le code va sur un autre appareil ?', ...blocQr, ...blocSecret));
  } else {
    ajout.push(...blocQr, depliant('Impossible de scanner ?', ...blocSecret));
  }
  const confirmer = el('button', { class: 'btn btn--plein', type: 'submit' }, 'Confirmer');
  let envoi = false;
  const code = champCode({ etiquette: 'Le code affiché dans l’appli', surComplet: () => form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })) });
  const form = el('form', { novalidate: true }, identifiantCache(ins.identifiant), code.boite, confirmer);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (envoi) return;
    const c = code.valeur();
    if (c.length !== 6) { erreur.textContent = 'Le code a 6 chiffres.'; return code.input.focus(); }
    envoi = true;
    erreur.textContent = '';
    const liberer = occuper(confirmer, 'Vérification…');
    try {
      const s = await api('/portal/admin/compte/confirmer', { methode: 'POST', auth: false, delai: 90000,
        corps: { jeton: ins.jeton, code: c, appareil: appareil() } });
      etat = etat ? { ...etat, premier_compte: false } : etat;
      toast('Ton compte est prêt.');
      await apresConnexion(s, { inscription });
    } catch (e) {
      envoi = false;
      liberer();
      if (e.code === 'expire') return ecranConnexion({ message: `${e.message} Connecte-toi avec ton mot de passe : un nouveau code sera proposé.` });
      erreur.textContent = e.message;
      code.vider();
      code.input.focus();
    }
  });
  afficher(inscription ? progression(2, 'Code de vérification') : null,
    titre('Ajoute ton code de vérification'),
    phrase('En plus du mot de passe, un code à 6 chiffres qui change toutes les 30 secondes. Même avec ton mot de passe, personne n’entre sans ton téléphone.'),
    ...ajout, erreur, form);
}

// ─── Dépannage ─────────────────────────────────────────────────────────────
function ecranDepannage() {
  const erreur = erreurZone();
  const ident = champ({ etiquette: 'Ton identifiant', type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none',
    autocorrect: 'off', spellcheck: 'false', required: true, maxlength: 30, value: lire('localStorage', IDENTIFIANT) || '' });
  const ancien = champMotDePasse({ etiquette: 'Ancien mot de passe du CRM', autocomplete: 'off', aide: 'Celui de Render (ADMIN_PASSWORD), que l’équipe utilisait avant les comptes.' });
  const nouveau = champMotDePasse({ etiquette: 'Nouveau mot de passe', facultatif: 'seulement si tu l’as oublié', autocomplete: 'new-password',
    regles: true, contexte: () => ({ identifiant: ident.input.value }) });
  focusSiOrdinateur(ident.input.value ? ancien.input : ident.input);
  const remettre = el('button', { class: 'btn btn--sombre btn--plein', type: 'submit' }, 'Remettre mon compte à zéro');
  const form = el('form', { novalidate: true }, ident.boite, ancien.boite, nouveau.boite, remettre);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    const id = ident.input.value.trim().toLowerCase();
    if (!id) { erreur.textContent = 'Écris ton identifiant.'; return ident.input.focus(); }
    if (!ancien.valeur()) { erreur.textContent = 'Écris l’ancien mot de passe du CRM.'; return ancien.input.focus(); }
    if (nouveau.valeur() && !nouveau.valide()) { erreur.textContent = 'Le nouveau mot de passe ne suit pas encore les règles.'; return nouveau.input.focus(); }
    const liberer = occuper(remettre, 'Remise à zéro…');
    try {
      await api('/portal/admin/depannage', { methode: 'POST', auth: false, delai: 90000,
        corps: { identifiant: id, ancien_mot_de_passe: ancien.valeur(), nouveau_mot_de_passe: nouveau.valeur(), appareil: appareil() } });
      const ici = cleIci();
      if (ici && ici.identifiant === id) oublierCleIci();
      ecrire('localStorage', IDENTIFIANT, id);
      afficher(el('div', { class: 'grand-icone grand-icone--ok' }, icone('i-ok')), titre('Compte remis à zéro'),
        phrase('Ton code de vérification et tes clés d’accès sont effacés, et toutes tes sessions sont fermées. Un courriel est parti à la boîte de l’agence.'),
        phrase('Connecte-toi avec ton mot de passe : le CRM te fera ajouter un nouveau code, puis Face ID ou l’empreinte.'),
        el('button', { class: 'btn btn--plein', type: 'button', 'data-focus': '', onclick: () => ecranConnexion() }, 'Se connecter'));
    } catch (e) { liberer(); erreur.textContent = e.message; }
  });
  afficher(titre('Problème pour entrer ?'),
    el('div', { class: 'info' }, el('b', null, 'Compte bloqué après 5 essais ratés'),
      el('span', null, 'Attends 15 minutes. Face ID et l’empreinte marchent encore pendant ce temps.')),
    el('div', { class: 'info info--attention' }, el('b', null, 'Téléphone perdu ou mot de passe oublié'),
      el('span', null, 'Remets ton compte à zéro avec l’ancien mot de passe du CRM : le code de vérification et les clés d’accès sont effacés, toutes tes sessions se ferment, et un courriel part à la boîte de l’agence.')),
    erreur, form, liens(lien('Retour', () => ecranConnexion())));
}
