// Les réglages du compte (la roue ⚙ de la barre) : Face ID et clés d'accès, mot de passe, associés
// (inviter quelqu'un), appareils, l'app sur cet appareil et l'historique de tout ce qui change.
// Les cartes sont dans la page (index.html) ; ce module les remplit.
import { $, el, icone, vider, date, relatif, heure, jourLong, majuscule, ymd, pluriel, toast, copier, biometrie } from './outils.js';
import { E } from './etat.js';
import { api, ErreurApi, sessionActuelle, retenirSession } from './api.js';
import { nomAppareil } from './appareil.js';
import { clesPossibles, biometrieDispo, preparer, creer, messageCle } from './cles.js';
import { blocInstaller, quandInstallChange } from './installer.js';
import { cleIci, retenirCleIci, oublierCleIci } from './connexion.js';
import { prenom } from './tableau.js';
import { detailJoli } from './argent.js';
import { champ, identifiantCache, champMotDePasse, champCode, occuper, erreurZone } from './ui.js';
import { chargerNotifications, rendreNotifications, viderNotifications } from './notifications.js';

const IDENTIFIANT_RE = /^[a-z][a-z0-9._-]{1,29}$/;
const ui = {
  construit: false, confirmer: '', formMdp: null, formInvitation: null, lien: null,
  options: null, optionsLues: 0, bio: null, plus: false
};

// ─── Chargement ────────────────────────────────────────────────────────────
export async function chargerCompte() {
  chargerNotifications();                               // sa propre carte : elle ne retarde jamais le reste
  try {
    E.moi = await api('/portal/admin/moi');
    E.moiErreur = '';
  } catch (e) {
    if (e.statut === 401) return;
    E.moiErreur = e.message;
  }
  rendreCompte();
}
export async function chargerJournal() {
  try {
    const d = await api(`/portal/admin/journal?n=${ui.plus ? 1000 : 200}`);
    E.journal = Array.isArray(d.lignes) ? d.lignes : [];
    E.journalErreur = '';
  } catch (e) {
    if (e.statut === 401) return;
    E.journalErreur = e.message;
  }
  rendreJournal();
}

export function viderCompte() {
  Object.assign(ui, { confirmer: '', formMdp: null, formInvitation: null, lien: null, options: null, plus: false });
  E.moi = null; E.moiErreur = ''; E.journal = null; E.journalErreur = '';
  viderNotifications();
  if (ui.construit) rendreCompte();
}

// ─── La page ───────────────────────────────────────────────────────────────
function construire() {
  if (ui.construit) return;
  ui.construit = true;
  const filtres = el('fieldset', { class: 'choix choix--petit' }, el('legend', { class: 'sr' }, 'Montrer'),
    el('div', { class: 'choix__liste' }, [['tout', 'Tout'], ['connexions', 'Connexions'], ['clients', 'Clients'], ['argent', 'Argent'], ['equipe', 'Équipe'], ['comptes', 'Comptes']].map(([v, t]) =>
      el('label', null, el('input', { type: 'radio', name: 'filtre-journal', value: v, checked: E.filtreJournal === v,
        onchange: () => { E.filtreJournal = v; rendreJournal(); } }), el('span', null, t)))));
  const tete = $('#carte-journal .carte__tete');
  if (tete) tete.append(filtres);
  biometrieDispo().then(v => { ui.bio = v; rendreSecurite(); });
  quandInstallChange(rendreAppli);
}

export function rendreCompte() {
  construire();
  rendreTete(); rendreSecurite(); rendreAppareils(); rendreNotifications(); rendreEquipe(); rendreAppli(); rendreJournal();
}

function attente(boite) {
  if (E.moiErreur && !E.moi) { vider(boite, el('p', { class: 'vide' }, E.moiErreur)); return true; }
  if (!E.moi) { vider(boite, el('p', { class: 'vide' }, 'Lecture en cours…')); return true; }
  return false;
}
const quandLong = iso => { const d = date(iso); return d ? `${jourLong(d)} à ${heure(d)}` : ''; };
const quandCourt = iso => { const d = date(iso); return d ? relatif(d) : ''; };
const jour = iso => { const d = date(iso); return d ? d.toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', day: 'numeric', month: 'long' }) : ''; };

function rendreTete() {
  const p = $('#compte-phrase');
  const s = sessionActuelle();
  if (!s) return;
  const fin = s.expire ? new Date(s.expire * 1000) : null;
  vider(p, 'Le compte de ', el('b', null, s.admin.nom), ` (${s.admin.identifiant})`,
    fin ? ` · session ouverte jusqu’à ${heure(fin)}${ymd(fin) !== ymd(new Date()) ? ' demain' : ''}` : '', '.');
}

// Une ligne avec une icône, un titre, un détail et une action à droite
function rangee({ icon, lettre, titre, badges = [], meta = [], action = null }) {
  return el('div', { class: 'rangee' },
    el('span', { class: 'rangee__icone', 'aria-hidden': 'true' }, lettre ? el('b', null, lettre) : icone(icon)),
    el('span', { class: 'rangee__texte' },
      el('span', { class: 'rangee__titre' }, titre, ...badges.filter(Boolean)),
      ...meta.filter(Boolean).map(m => el('span', { class: 'rangee__meta' }, m))),
    action ? el('span', { class: 'rangee__action' }, action) : el('span'));
}
const badge = (texte, genre = '') => el('span', { class: `badge${genre ? ` badge--${genre}` : ''}` }, texte);

// Confirmer sur place (pas de fenêtre du navigateur) : « Retirer ? Oui · Non »
function action(cle, libelle, question, faire, { danger = true } = {}) {
  if (ui.confirmer !== cle) {
    return el('button', { class: 'btn btn--contour btn--petit', type: 'button',
      onclick: () => { ui.confirmer = cle; rendreCompte(); const oui = document.querySelector(`[data-confirmer="${CSS.escape(cle)}"]`); if (oui) oui.focus(); } }, libelle);
  }
  const oui = el('button', { class: `btn btn--petit ${danger ? 'btn--danger' : ''}`, type: 'button', 'data-confirmer': cle }, 'Oui');
  oui.addEventListener('click', async () => {
    const liberer = occuper(oui, '…');
    try { await faire(); ui.confirmer = ''; }
    catch (e) { liberer(); toast(e.message || 'Ça n’a pas marché. Réessaie.', true); return; }
    rendreCompte();
  });
  return el('span', { class: 'confirmer', role: 'group', 'aria-label': question },
    el('span', { class: 'confirmer__question' }, question),
    el('span', { class: 'confirmer__boutons' },
      el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { ui.confirmer = ''; rendreCompte(); } }, 'Non'), oui));
}

// ─── Connexion et sécurité ─────────────────────────────────────────────────
function prechargerOptions() {
  if (ui.options && Date.now() - ui.optionsLues < 4 * 60e3) return;
  ui.options = null;
  preparer('inscription').then(o => { ui.options = o; ui.optionsLues = Date.now(); }).catch(() => { ui.options = null; });
}

function rendreSecurite() {
  const boite = $('#compte-securite');
  if (!boite || attente(boite)) return;
  const moi = E.moi, bio = biometrie(), ici = cleIci();
  const moiIci = ici && ici.identifiant === moi.identifiant;
  const cles = Array.isArray(moi.cles) ? moi.cles : [];
  const lignes = [];

  // Face ID / empreinte sur CET appareil
  let actionBio = null, metaBio = '';
  if (!clesPossibles() || !moi.cles_dispo) metaBio = 'Ce navigateur ne permet pas les clés d’accès : le mot de passe et le code restent là.';
  else if (moiIci) metaBio = `Activé${bio.e} ici : le CRM s’ouvre d’un geste.`;
  else if (ui.bio === false) metaBio = 'Ni Face ID ni empreinte ici : une clé d’accès peut passer par ton téléphone.';
  else metaBio = `Pas encore activé${bio.e} ici. Rien de ton visage ou de ton doigt ne quitte l’appareil.`;
  if (clesPossibles() && moi.cles_dispo && !moiIci) {
    prechargerOptions();
    const bouton = el('button', { class: 'btn btn--petit', type: 'button' }, icone(bio.icone), 'Activer ici');
    bouton.addEventListener('click', () => activerIci(bouton));
    actionBio = bouton;
  }
  lignes.push(rangee({ icon: bio.icone, titre: majuscule(bio.nom), badges: [moiIci ? badge(`Activé${bio.e} ici`) : null], meta: [metaBio], action: actionBio }));

  cles.forEach(c => {
    const surCet = moiIci && ici.id && ici.id === c.id;
    lignes.push(rangee({ icon: 'i-cle', titre: c.nom || 'Clé d’accès', badges: [surCet ? badge('Cet appareil', 'neutre') : null],
      meta: [[c.cree && `Ajoutée le ${jour(c.cree)}`, c.utilisee ? `utilisée ${quandCourt(c.utilisee)}` : 'pas encore utilisée'].filter(Boolean).join(' · ')],
      action: action(`cle:${c.id}`, 'Retirer', 'Retirer cette clé ?', async () => {
        const r = await api('/portal/admin/cle/retirer', { methode: 'POST', corps: { id: c.id } });
        E.moi.cles = r.cles || [];
        if (surCet) oublierCleIci();
        toast('Clé d’accès retirée.');
      }) }));
  });

  // Mot de passe
  const ouvert = !!ui.formMdp;
  lignes.push(rangee({ icon: 'i-verrou', titre: 'Mot de passe', meta: ['Le changer déconnecte tes autres appareils.'],
    action: ouvert ? null : el('button', { class: 'btn btn--contour btn--petit', type: 'button',
      onclick: () => { ui.formMdp = formulaireMotDePasse(); rendreSecurite(); ui.formMdp.querySelector('input:not([readonly])').focus(); } }, 'Changer') }));
  if (ouvert) lignes.push(ui.formMdp);

  lignes.push(rangee({ icon: 'i-horloge', titre: 'Code de vérification', badges: [badge('Actif')],
    meta: ['À chaque connexion. Nouveau téléphone : « Problème pour entrer ? » à l’écran de connexion.'] }));
  vider(boite, el('div', { class: 'rangees' }, lignes));
}

async function activerIci(bouton) {
  const bio = biometrie();
  if (!ui.options) {
    const liberer = occuper(bouton, '…');
    preparer('inscription').then(o => { ui.options = o; ui.optionsLues = Date.now(); }).catch(() => {}).finally(() => {
      liberer(); toast(ui.options ? 'C’est prêt : touche « Activer ici » encore une fois.' : 'Le serveur ne répond pas. Réessaie dans une minute.', !ui.options);
    });
    return;
  }
  const o = ui.options;
  ui.options = null;
  const liberer = occuper(bouton, 'Création…');
  try {
    const reponse = await creer(o);
    const r = await api('/portal/admin/cle/inscrire', { methode: 'POST', delai: 90000, corps: { defi: o.defi, reponse, nom: nomAppareil() } });
    retenirCleIci(E.moi.identifiant, reponse.id);
    E.moi.cles = r.cles || E.moi.cles;
    toast(`${majuscule(bio.nom)} est activé${bio.e} sur cet appareil.`);
    rendreSecurite();
  } catch (e) {
    liberer();
    if (e && e.name === 'InvalidStateError') { retenirCleIci(E.moi.identifiant); toast('Cet appareil avait déjà sa clé d’accès.'); return rendreSecurite(); }
    const m = e instanceof ErreurApi ? e.message : messageCle(e, bio.nom);
    if (m) toast(m, true);
    prechargerOptions();
  }
}

function formulaireMotDePasse() {
  const moi = E.moi;
  const erreur = erreurZone();
  const actuel = champMotDePasse({ etiquette: 'Mot de passe actuel', autocomplete: 'current-password' });
  const nouveau = champMotDePasse({ etiquette: 'Nouveau mot de passe', autocomplete: 'new-password', regles: true,
    contexte: () => ({ prenom: moi.nom, identifiant: moi.identifiant }) });
  const code = champCode({ etiquette: 'Code de vérification' });
  const enregistrer = el('button', { class: 'btn btn--petit', type: 'submit' }, 'Enregistrer');
  const annuler = el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { ui.formMdp = null; rendreSecurite(); } }, 'Annuler');
  const form = el('form', { class: 'formulaire formulaire--encadre', novalidate: true },
    identifiantCache(moi.identifiant),
    actuel.boite, nouveau.boite, code.boite, erreur, el('div', { class: 'formulaire__pied' }, annuler, enregistrer));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    if (!actuel.valeur()) { erreur.textContent = 'Écris ton mot de passe actuel.'; return actuel.input.focus(); }
    if (!nouveau.valide()) { erreur.textContent = 'Le nouveau mot de passe ne suit pas encore les règles.'; return nouveau.input.focus(); }
    if (code.valeur().length !== 6) { erreur.textContent = 'Écris le code à 6 chiffres de ton appli.'; return code.input.focus(); }
    const liberer = occuper(enregistrer, 'Enregistrement…');
    try {
      const s = await api('/portal/admin/moi/mot_de_passe', { methode: 'POST', delai: 90000,
        corps: { actuel: actuel.valeur(), nouveau: nouveau.valeur(), code: code.valeur() } });
      retenirSession(s);
      ui.formMdp = null;
      toast('Mot de passe changé. Tes autres appareils sont déconnectés.');
      chargerCompte(); chargerJournal();
    } catch (e) { liberer(); erreur.textContent = e.message; }
  });
  return form;
}

// ─── Appareils ─────────────────────────────────────────────────────────────
const estMobile = nom => /iPhone|iPad|Android|Téléphone|Tablette/i.test(nom || '');

function rendreAppareils() {
  const boite = $('#compte-appareils');
  if (!boite || attente(boite)) return;
  const moi = E.moi;
  const liste = Array.isArray(moi.appareils) ? moi.appareils : [];
  const lignes = liste.map(a => {
    const ici = a.id === moi.appareil;
    const meta = [ici ? 'Tu l’utilises en ce moment' : (a.connecte ? 'Session ouverte' : 'Aucune session ouverte'),
      !ici && a.vu ? `vu ${quandCourt(a.vu)}` : '', a.premier ? `connu depuis le ${jour(a.premier)}` : ''].filter(Boolean).join(' · ');
    return rangee({ icon: estMobile(a.nom) ? 'i-telephone' : 'i-ordinateur', titre: a.nom || 'Appareil', badges: [ici ? badge('Cet appareil', 'neutre') : null],
      meta: [meta], action: ici ? null : action(`appareil:${a.id}`, a.connecte ? 'Déconnecter' : 'Retirer',
        a.connecte ? 'Déconnecter cet appareil ?' : 'Retirer de la liste ?', async () => {
          await api('/portal/admin/moi/appareil/retirer', { methode: 'POST', corps: { id: a.id } });
          E.moi.appareils = E.moi.appareils.filter(x => x.id !== a.id);
          toast(a.connecte ? 'Appareil déconnecté.' : 'Appareil retiré.');
          chargerJournal();
        }) });
  });
  const autresOuverts = liste.some(a => a.id !== moi.appareil && a.connecte);
  const blocs = [el('div', { class: 'rangees' }, lignes.length ? lignes : el('p', { class: 'vide' }, 'Aucun appareil pour l’instant.'))];
  if (autresOuverts) {
    blocs.push(el('div', { class: 'carte__pied' }, action('partout', 'Déconnecter tous les autres appareils', 'Fermer toutes les autres sessions ?', async () => {
      const s = await api('/portal/admin/moi/deconnecter_partout', { methode: 'POST' });
      retenirSession(s);
      toast('Tes autres appareils sont déconnectés.');
      chargerCompte(); chargerJournal();
    })));
  }
  blocs.push(el('p', { class: 'note' }, 'Un nouvel appareil envoie une alerte à la boîte de l’agence.'));
  vider(boite, blocs);
}

// ─── Équipe ────────────────────────────────────────────────────────────────
const versIdentifiant = p => String(p || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 30);

function rendreEquipe() {
  const boite = $('#compte-equipe');
  if (!boite) return;
  if (!E.moi) return vider(boite);
  const moi = E.moi;
  const equipe = Array.isArray(moi.equipe) ? moi.equipe : [];
  const comptes = equipe.filter(m => m.etat !== 'invite');
  const qui = comptes.map(m => {
    const nom = prenom(m.nom) || m.identifiant;
    if (m.identifiant === moi.identifiant) return `${nom} (toi)`;
    if (m.etat === 'a_confirmer') return `${nom}, code à ajouter`;
    return m.derniere_connexion ? `${nom}, vu ${quandCourt(m.derniere_connexion)}` : `${nom}, pas encore connecté`;
  }).join(' · ');
  const peutInviter = equipe.length < 4 && !ui.lien && !ui.formInvitation;
  const lignes = [rangee({ icon: 'i-clients', titre: 'Associés', meta: [qui, 'Chacun son compte, son code et son Face ID. 4 comptes au plus.'],
    action: peutInviter ? el('button', { class: 'btn btn--contour btn--petit', type: 'button',
      onclick: () => { ui.formInvitation = formulaireInvitation(); rendreEquipe(); ui.formInvitation.querySelector('input').focus(); } }, 'Inviter') : null })];
  equipe.filter(m => m.etat === 'invite').forEach(m => lignes.push(rangee({
    lettre: (prenom(m.nom) || m.identifiant).charAt(0).toUpperCase(), titre: `${m.nom} (${m.identifiant})`, badges: [badge('Invitation en attente', 'attente')],
    meta: [m.invitation_expire ? `Lien valable jusqu’au ${quandLong(m.invitation_expire)}` : 'Lien d’invitation envoyé'],
    action: action(`invitation:${m.identifiant}`, 'Annuler', 'Annuler l’invitation ?', async () => {
      await api('/portal/admin/invitation/annuler', { methode: 'POST', corps: { identifiant: m.identifiant } });
      if (ui.lien && ui.lien.identifiant === m.identifiant) ui.lien = null;
      toast('Invitation annulée : le lien ne marche plus.');
      await chargerCompte(); chargerJournal();
    }) })));
  const blocs = [el('div', { class: 'rangees' }, lignes)];
  if (ui.lien) blocs.push(blocLien(ui.lien));
  else if (ui.formInvitation) blocs.push(ui.formInvitation);
  vider(boite, blocs);
}

function formulaireInvitation() {
  const erreur = erreurZone();
  const prenomC = champ({ etiquette: 'Prénom de la personne', type: 'text', autocomplete: 'off', required: true, maxlength: 40 });
  const ident = champ({ etiquette: 'Son identifiant', aide: 'Lettres minuscules et chiffres. La personne l’écrira pour se connecter.',
    type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true, maxlength: 30 });
  let touche = false;
  prenomC.input.addEventListener('input', () => { if (!touche) ident.input.value = versIdentifiant(prenomC.input.value); });
  ident.input.addEventListener('input', () => { touche = true; });
  const creerBtn = el('button', { class: 'btn btn--petit', type: 'submit' }, 'Créer le lien');
  const annuler = el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { ui.formInvitation = null; rendreEquipe(); } }, 'Annuler');
  const form = el('form', { class: 'formulaire formulaire--encadre', novalidate: true }, prenomC.boite, ident.boite, erreur,
    el('div', { class: 'formulaire__pied' }, annuler, creerBtn));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    const nom = prenomC.input.value.trim(), id = ident.input.value.trim().toLowerCase();
    if (!nom) { erreur.textContent = 'Écris son prénom.'; return prenomC.input.focus(); }
    if (!IDENTIFIANT_RE.test(id)) { erreur.textContent = 'Identifiant : lettres minuscules et chiffres, de 2 à 30 caractères, en commençant par une lettre.'; return ident.input.focus(); }
    const liberer = occuper(creerBtn, 'Création…');
    try {
      const r = await api('/portal/admin/invitation', { methode: 'POST', corps: { identifiant: id, nom } });
      ui.formInvitation = null;
      ui.lien = { identifiant: id, nom, lien: r.lien, expire: r.expire };
      await chargerCompte();
      chargerJournal();
      const copierBtn = document.querySelector('#compte-equipe [data-copier-lien]');
      if (copierBtn) copierBtn.focus();
    } catch (e) { liberer(); erreur.textContent = e.message; }
  });
  return form;
}

function blocLien(l) {
  const partageable = !!navigator.share;
  const texte = `${prenom(l.nom)}, voici ton lien pour créer ton compte dans le CRM d’Agence UIO (valable 48 heures, une seule fois) :`;
  return el('div', { class: 'formulaire formulaire--encadre' },
    el('p', { class: 'champ__titre' }, `Le lien de ${prenom(l.nom)}`),
    el('div', { class: 'lien-invitation' }, l.lien),
    el('p', { class: 'note' }, `Envoie-le seulement à ${prenom(l.nom)}, par texto ou WhatsApp. Il marche jusqu’au ${quandLong(l.expire)}, une seule fois. Si tu te trompes de personne : « Annuler » ci-dessus.`),
    el('div', { class: 'formulaire__pied' },
      el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { ui.lien = null; rendreEquipe(); } }, 'Terminé'),
      partageable ? el('button', { class: 'btn btn--contour btn--petit', type: 'button',
        onclick: () => navigator.share({ title: 'CRM d’Agence UIO', text: texte, url: l.lien }).catch(() => {}) }, icone('i-partager'), 'Partager') : null,
      el('button', { class: 'btn btn--petit', type: 'button', 'data-copier-lien': '',
        onclick: async () => toast(await copier(l.lien) ? 'Lien copié.' : 'Copie impossible : sélectionne le lien à la main.', false) }, icone('i-copier'), 'Copier le lien')));
}

// ─── L'application ─────────────────────────────────────────────────────────
function rendreAppli() {
  const boite = $('#compte-appli');
  if (!boite) return;
  vider(boite, blocInstaller(), el('p', { class: 'note' }, 'Elle se met à jour toute seule et se verrouille après 15 minutes en arrière-plan.'));
}

// ─── Journal ───────────────────────────────────────────────────────────────
const ACTIONS = {
  'connexion': ['Connexion', 'connexions'],
  'connexion.ratee': ['Connexion refusée', 'connexions', true],
  'deconnexion': ['Déconnexion', 'connexions'],
  'compte.bloque': ['Compte bloqué 15 minutes', 'connexions', true],
  'compte.creation': ['Compte créé', 'comptes'],
  'compte.active': ['Compte activé', 'comptes'],
  'compte.mot_de_passe': ['Mot de passe changé', 'comptes'],
  'compte.deconnexion_partout': ['Autres appareils déconnectés', 'comptes'],
  'compte.appareil_retire': ['Appareil retiré', 'comptes'],
  'compte.invitation': ['Invitation créée', 'comptes'],
  'compte.invitation_annulee': ['Invitation annulée', 'comptes'],
  'cle.ajoutee': ['Clé d’accès ajoutée', 'comptes'],
  'cle.retiree': ['Clé d’accès retirée', 'comptes'],
  'notifications.appareil_ajoute': ['Notifications activées', 'comptes'],
  'notifications.reactivees': ['Notifications réactivées', 'comptes'],
  'notifications.reprises': ['Notifications reprises', 'comptes'],
  'notifications.sortes': ['Choix des notifications changé', 'comptes'],
  'notifications.appareil_retire': ['Notifications coupées', 'comptes'],
  'depannage': ['Compte remis à zéro (dépannage)', 'comptes', true],
  'depannage.refuse': ['Dépannage refusé', 'comptes', true],
  'client.modifie': ['Client modifié', 'clients'],
  'client.ajoute': ['Client ajouté', 'clients'],
  'client.mot_de_passe': ['Nouveau mot de passe pour un client', 'clients'],
  'fiches.modifie': ['Fiche client modifiée', 'clients'],
  'fiches.rappel': ['Rappel de paiement envoyé', 'clients'],
  'fiches.rapport': ['Rapport du mois envoyé', 'clients'],
  'rapports.note': ['Rapport du mois noté', 'clients'],
  'prospects.ajoute': ['Prospect ajouté', 'clients'],
  'prospects.etape': ['Prospect : nouvelle étape', 'clients'],
  'prospects.importes': ['Prospects importés', 'clients'],
  'prospects.modifie': ['Prospect modifié', 'clients'],
  'prospects.retire': ['Prospect retiré', 'clients'],
  'prospects.suivi': ['Contact noté avec un prospect', 'clients'],
  'demandes.retiree': ['Demande du chatbot retirée', 'clients'],
  'demandes.remise': ['Demande du chatbot remise', 'clients'],
  'argent.abonnement.ajoute': ['Abonnement ajouté', 'argent'],
  'argent.abonnement.modifie': ['Abonnement modifié', 'argent'],
  'argent.abonnement.termine': ['Abonnement terminé', 'argent'],
  'argent.abonnement.repris': ['Abonnement repris', 'argent'],
  'argent.abonnement.rembourse': ['Remboursé avec la garantie', 'argent'],
  'argent.abonnement.supprime': ['Abonnement supprimé', 'argent'],
  'argent.ajout.ajoute': ['Ligne ajoutée à une facture', 'argent'],
  'argent.ajout.retire': ['Ligne retirée d’une facture', 'argent'],
  'argent.paiement.ajoute': ['Paiement noté', 'argent'],
  'argent.paiement.annule': ['Paiement annulé', 'argent'],
  'argent.depense.ajoutee': ['Dépense ajoutée', 'argent'],
  'argent.depense.modifiee': ['Dépense modifiée', 'argent'],
  'argent.depense.retiree': ['Dépense retirée', 'argent'],
  'argent.virement.ajoute': ['Virement noté', 'argent'],
  'argent.virement.annule': ['Virement annulé', 'argent'],
  'argent.solde.note': ['Solde de crédit noté', 'argent'],
  'equipe.tache.ajoutee': ['Tâche ajoutée', 'equipe'],
  'equipe.tache.modifiee': ['Tâche changée', 'equipe'],
  'equipe.tache.commencee': ['Tâche commencée', 'equipe'],
  'equipe.tache.faite': ['Tâche faite', 'equipe'],
  'equipe.tache.rouverte': ['Tâche remise à faire', 'equipe'],
  'equipe.tache.annulee': ['Tâche annulée', 'equipe'],
  'equipe.recap.ajoute': ['Récap publié', 'equipe'],
  'equipe.recap.retire': ['Récap retiré', 'equipe'],
  'equipe.note': ['Note ajoutée', 'equipe'],
  'equipe.chrono.debut': ['Chrono démarré', 'equipe'],
  'equipe.chrono.fin': ['Chrono arrêté', 'equipe'],
  'equipe.heures.ajoutees': ['Session ajoutée aux heures', 'equipe'],
  'equipe.heures.corrigees': ['Heures corrigées', 'equipe'],
  'equipe.heures.retirees': ['Session retirée des heures', 'equipe'],
  'equipe.document.ajoute': ['Document ajouté', 'equipe'],
  'equipe.document.modifie': ['Document changé', 'equipe'],
  'equipe.document.retire': ['Document retiré', 'equipe'],
  'equipe.cle.creee': ['Clé pour Claude créée', 'comptes'],
  'equipe.cle.retiree': ['Clé pour Claude retirée', 'comptes']
};

function rendreJournal() {
  const boite = $('#compte-journal');
  if (!boite) return;
  if (E.journalErreur && !E.journal) return vider(boite, el('p', { class: 'vide' }, E.journalErreur));
  if (!E.journal) return vider(boite, el('p', { class: 'vide' }, 'Lecture de l’historique…'));
  const noms = new Map(((E.moi && E.moi.equipe) || []).map(m => [m.identifiant, prenom(m.nom) || m.identifiant]));
  const clients = new Map((E.clients || []).map(c => [c.client_id, c.project_name || c.client_id]));
  const lignes = E.journal.filter(l => E.filtreJournal === 'tout' || (ACTIONS[l.action] || [])[1] === E.filtreJournal);
  if (!lignes.length) return vider(boite, el('p', { class: 'vide' }, E.journal.length ? 'Rien de ce genre pour l’instant.' : 'L’historique est vide pour l’instant.'));
  const auj = ymd(new Date()), hier = ymd(new Date(Date.now() - 864e5));
  const items = [];
  let jourCourant = '';
  lignes.forEach(l => {
    const d = date(l.quand);
    const j = d ? ymd(d) : '';
    if (j !== jourCourant) {
      jourCourant = j;
      items.push(el('li', { class: 'journal__jour' }, j === auj ? 'Aujourd’hui' : j === hier ? 'Hier' : d ? majuscule(jourLong(d)) : 'Date inconnue'));
    }
    const [libelle, , rate] = ACTIONS[l.action] || [l.action || 'Changement', '', false];
    const qui = noms.get(l.qui) || l.qui;
    const act = String(l.action || '');
    const cible = /^(client|fiches)\./.test(act) ? clients.get(l.cible) || l.cible
      : act === 'rapports.note' ? String(l.cible || '').replace(/^\S+/, id => clients.get(id) || id)
        : (l.cible && l.cible !== l.qui ? noms.get(l.cible) || l.cible : '');
    const detail = /^(argent|equipe)\./.test(String(l.action || '')) ? detailJoli(l.detail) : l.detail;
    const meta = [qui && qui !== '?' ? qui : '', detail, l.appareil && !String(l.detail || '').includes(l.appareil) ? l.appareil : '', l.ip ? `réseau ${l.ip}` : ''].filter(Boolean).join(' · ');
    items.push(el('li', { class: rate ? 'rate' : null },
      el('time', { datetime: l.quand }, d ? heure(d) : ''),
      el('span', { class: 'journal__quoi' },
        el('span', { class: 'journal__titre' }, libelle, cible ? [' · ', el('b', null, cible)] : null),
        meta ? el('span', { class: 'journal__meta' }, meta) : null)));
  });
  const blocs = [el('ul', { class: 'journal' }, items)];
  if (!ui.plus && E.journal.length >= 200) {
    blocs.push(el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => { ui.plus = true; chargerJournal(); } }, 'Voir plus ancien'));
  }
  blocs.push(el('p', { class: 'note' }, 'Chaque connexion et chaque changement, avec l’appareil et le réseau. Les 3 000 dernières lignes sont gardées.'));
  vider(boite, blocs);
}
