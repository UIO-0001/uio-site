// Clients : la liste (une carte par client : son service, son forfait, sa prochaine facture, ses
// minutes du cycle, et l'appeler ou lui écrire d'un toucher), la carte « Clients » du tableau de
// bord, et un nouveau client.
// La fiche de chaque client (fiche.js) remplace l'ancien « avancement en % + étapes » (2026-11-08).
import { $, icone, vider, nombre, pluriel, toast, copier, normal, urlSure, lienTel, lienCourriel, signal } from './outils.js';
import { E, ESPACE_CLIENT } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { gros, rendreBonjour } from './tableau.js';
import { montrer } from './navigation.js';
import { ouvrirPanneau, fermerPanneau } from './panneau.js';
import { el } from './formes.js';
import { argent as montant, badgeFacture, leJour } from './argent.js';
import { ficheDe, documentsDe, abonnementDe, aEncaisser, badgeStatut, ouvrirFiche } from './fiche.js';

// ─── Lecture ───────────────────────────────────────────────────────────────
// L'espace client (comptes, note, démo, fonctionnalités) et les fiches, lus ensemble
export async function chargerClients(auto = false) {
  // Jamais par-dessus une modification en cours, ni un rappel ou un document qu'on écrit
  if (auto && E.panneau && ((E.panneau.modifie && E.panneau.modifie()) || (E.panneau.occupe && E.panneau.occupe()))) return;
  const s = sessionActuelle();
  const [clients, fiches] = await Promise.allSettled([
    api('/portal/admin/clients', { delai: 80000 }),
    api('/portal/admin/fiches', { delai: 80000 })
  ]);
  if (sessionActuelle() !== s) return;            // verrouillé pendant la lecture : rien n'est gardé
  if (clients.status === 'fulfilled') {
    const d = clients.value;
    E.clients = Array.isArray(d.clients) ? d.clients : [];
    E.fonctionnalites = Array.isArray(d.available_features) ? d.available_features : [];
    E.clientsErreur = ''; E.clientsLus = true;
  } else {
    if (clients.reason.statut === 401) return;
    E.clientsErreur = clients.reason.message;
  }
  if (fiches.status === 'fulfilled') garderFiches(fiches.value);
  else if (fiches.reason.statut !== 401) E.fichesErreur = fiches.reason.statut === 404 ? 'pas-encore' : fiches.reason.message;
  apresLecture();
}

// Seulement les fiches (après un envoi, ou un changement dans l'Argent)
export async function chargerFiches() {
  const s = sessionActuelle();
  try {
    const d = await api('/portal/admin/fiches', { delai: 80000 });
    if (sessionActuelle() !== s) return;
    garderFiches(d);
  } catch (e) {
    if (e.statut === 401 || sessionActuelle() !== s) return;
    E.fichesErreur = e.statut === 404 ? 'pas-encore' : e.message;
  }
  apresLecture();
}

// Chaque réponse du serveur sur les fiches les porte toutes : on les garde telles quelles
export function garderFiches(r) {
  if (!r || !r.fiches || typeof r.fiches !== 'object') return;
  E.fiches = { fiches: r.fiches, documents: Array.isArray(r.documents) ? r.documents : [], statuts: r.statuts || null,
    langues: r.langues || null, envoi_du_mois: r.envoi_du_mois || null, repondre_a: r.repondre_a || '', genere_a: r.genere_a || '' };
  E.fichesErreur = '';
}

function apresLecture() {
  rendreClients(); rendrePortail(); rendreBonjour();
  if (E.panneau && E.panneau.type === 'client' && E.panneau.rafraichir && !(E.panneau.occupe && E.panneau.occupe())) E.panneau.rafraichir();
}

// ─── Ordre : ce qui demande quelque chose d'abord ──────────────────────────
const RANGS = { mise_en_place: 2, en_service: 3, termine: 4 };
const nomDe = c => String(c.project_name || c.client_id || '');
function priorite(c) {
  const dues = aEncaisser(ficheDe(c));
  if (dues.some(x => x.etat === 'en_retard')) return 0;
  if (dues.length) return 1;
  return RANGS[ficheDe(c).statut] ?? 3;
}
const trier = liste => [...liste].sort((a, b) => priorite(a) - priorite(b) || nomDe(a).localeCompare(nomDe(b), 'fr', { sensitivity: 'base' }));
// « Répondeur · 199 $ par mois »
const forfaitCourt = ab => (ab ? `${ab.forfait_nom} · ${montant(ab.total_mensuel)} par mois` : '');
// « Facture 2 · 199 $ », ou « 2 factures · 398 $ »
function aPayer(dues) {
  if (!dues.length) return '';
  if (dues.length === 1) return `Facture ${dues[0].numero} · ${montant(dues[0].reste)}`;
  return `${dues.length} factures · ${montant(dues.reduce((s, x) => s + (Number(x.reste) || 0), 0))}`;
}

// ─── Le tableau de bord : la carte « Espace client » ───────────────────────
export function rendrePortail() {
  const boite = $('#portail');
  if (!boite) return;
  if (!E.clientsLus) return vider(boite, el('p', { class: 'vide' }, E.clientsErreur || 'Lecture en cours…'));
  const n = E.clients.length;
  if (!n) { signal('carte-portail', ''); return vider(boite, el('p', { class: 'vide' }, 'Aucun client pour l’instant.')); }
  const compte = { en_service: 0, mise_en_place: 0, termine: 0 };
  let retards = 0, dues = 0;
  for (const c of E.clients) {
    const f = ficheDe(c), d = aEncaisser(f);
    compte[f.statut] = (compte[f.statut] || 0) + 1;
    retards += d.filter(x => x.etat === 'en_retard').length;
    dues += d.filter(x => x.etat === 'due').length;
  }
  signal('carte-portail', retards ? 'alerte' : dues ? 'attente' : '');
  // « 2 en service, 1 en mise en place et 1 terminé. »
  const morceaux = [];
  if (compte.en_service) morceaux.push([[nombre(compte.en_service)], ' en service']);
  if (compte.mise_en_place) morceaux.push([[nombre(compte.mise_en_place)], ' en mise en place']);
  if (compte.termine) morceaux.push([[nombre(compte.termine)], compte.termine >= 2 ? ' terminés' : ' terminé']);
  const phrase = [];
  morceaux.forEach((m, i) => { if (i) phrase.push(i === morceaux.length - 1 ? ' et ' : ', '); phrase.push(...m); });
  phrase.push('.');
  if (retards) phrase.push(' ', el('b', { class: 'attention' }, pluriel(retards, 'facture en retard', 'factures en retard')), '.');
  else if (dues) phrase.push(' ', [pluriel(dues, 'facture due', 'factures dues')], '.');
  vider(boite, gros(n, n >= 2 ? 'clients' : 'client', ...phrase),
    el('div', { class: 'raccourcis' }, trier(E.clients).slice(0, 5).map(c => {
      const f = ficheDe(c), d = aEncaisser(f), ab = abonnementDe(f);
      return el('button', { class: 'raccourci raccourci--bouton raccourci--client', type: 'button', 'data-focus': `raccourci-${c.client_id}`, onclick: () => ouvrirClient(c.client_id) },
        el('b', null, nomDe(c)),
        d.length ? badgeFacture(d[0]) : badgeStatut(f.statut),
        el('span', null, d.length ? aPayer(d) : forfaitCourt(ab) || f.contact || `@${c.username}`));
    })));
}

// ─── La liste des clients ──────────────────────────────────────────────────
const texteRecherche = c => {
  const f = ficheDe(c);
  return normal([c.project_name, c.client_id, c.username, f.contact, f.courriel, f.telephone, f.metier, f.site].join(' '));
};

export function rendreClients() {
  const boite = $('#clients-liste');
  if (!boite) return;
  const n = E.clientsLus ? String(E.clients.length) : '';
  if (E.sousClients !== 'prospects') $('#clients-compte').textContent = n;   // sinon : le nombre de prospects
  if ($('#n-clients')) $('#n-clients').textContent = n;
  if (!E.clientsLus) return vider(boite, el('p', { class: 'vide' }, E.clientsErreur || 'Lecture en cours…'));
  if (!E.clients.length) {
    return vider(boite, el('p', { class: 'vide' }, 'Aucun client pour l’instant. ', el('b', null, 'Nouveau client'), ' crée son accès à l’espace client et sa fiche.'));
  }
  const q = normal(E.recherche).trim();
  const liste = trier(E.clients).filter(c => !q || texteRecherche(c).includes(q));
  const avis = E.fichesErreur && E.fichesErreur !== 'pas-encore' && !E.fiches
    ? el('p', { class: 'note clients__avis' }, `Les fiches n’ont pas pu être lues (${E.fichesErreur}) : statut et factures manquent pour l’instant.`) : null;
  if (!liste.length) return vider(boite, avis, el('p', { class: 'vide' }, `Aucun client ne correspond à « ${E.recherche.trim()} ».`));
  vider(boite, avis, liste.map(carteClient));
}

// Sa prochaine facture pas encore due, et ses minutes du cycle (onglet Argent, s'il est lu)
const prochaineFacture = ab => (ab ? (ab.factures || []).filter(x => x.etat === 'a_venir' && x.du > 0)
  .sort((a, b) => String(a.echeance).localeCompare(String(b.echeance)))[0] || null : null);
function minutesDe(ab) {
  const m = E.argent && E.argent.minutes;
  if (!ab || !m || !m.disponible) return null;
  return (m.clients || []).find(x => x.abonnement === ab.id) || null;
}
const chiffre = (titre, valeur, genre = '') => el('div', { class: `client__chiffre${genre ? ` client__chiffre--${genre}` : ''}` },
  el('dt', null, titre), el('dd', null, valeur));

function carteClient(c) {
  const f = ficheDe(c), ab = abonnementDe(f), dues = aEncaisser(f);
  const docs = documentsDe(c.client_id).length;
  const actives = E.fonctionnalites.filter(x => c.features && c.features[x.key]);
  const qui = [f.contact, f.metier].filter(Boolean).join(' · ') || `@${c.username}`;
  const tel = lienTel(f.telephone), courriel = lienCourriel(f.courriel);
  const retard = dues.some(x => x.etat === 'en_retard');
  const chiffres = [];
  if (dues.length) chiffres.push(chiffre(retard ? 'En retard' : 'À encaisser', [aPayer(dues), ' ', badgeFacture(dues[0])], retard ? 'alerte' : 'attente'));
  else {
    const suivante = prochaineFacture(ab);
    if (suivante) chiffres.push(chiffre('Prochaine facture', `${montant(suivante.du)} le ${leJour(suivante.echeance)}`));
  }
  const mi = minutesDe(ab);
  if (mi) {
    const n = v => nombre(v, v % 1 ? 1 : 0);
    const pct = mi.pourcentage;
    chiffres.push(chiffre('Minutes du cycle', [mi.incluses ? `${n(mi.minutes)} / ${nombre(mi.incluses)} min` : `${n(mi.minutes)} min`,
      mi.incluses ? el('span', { class: `jauge${pct >= 100 ? ' jauge--rouge' : mi.alerte ? '' : ' jauge--bleu'}`, role: 'img', 'aria-label': `${pct} % des minutes du forfait` },
        el('i', { style: `width:${Math.min(100, Math.max(0, pct || 0))}%` })) : null], pct >= 100 ? 'alerte' : mi.alerte ? 'attente' : ''));
  }
  const marques = [
    ...actives.map(x => el('span', { class: 'marque' }, x.label)),
    f.rapport_auto ? el('span', { class: 'marque marque--bleu' }, 'Rapport par courriel') : null,
    docs ? el('span', { class: 'client__docs' }, icone('i-document'), pluriel(docs, 'document', 'documents')) : null
  ].filter(Boolean);
  return el('article', { class: `client${retard ? ' client--retard' : ''}`, 'data-id': c.client_id },
    el('div', { class: 'client__haut' },
      el('button', { class: 'client__nom', type: 'button', 'data-focus': `client-${c.client_id}`, onclick: () => ouvrirClient(c.client_id) }, nomDe(c)),
      badgeStatut(f.statut)),
    el('p', { class: 'client__meta' }, [qui, forfaitCourt(ab) || 'Pas encore d’abonnement'].join(' · ')),
    chiffres.length ? el('dl', { class: 'client__chiffres' }, chiffres) : null,
    marques.length ? el('div', { class: 'client__marques' }, marques) : null,
    tel || courriel ? el('div', { class: 'client__actions' },
      tel ? el('a', { class: 'puce', href: tel, title: f.telephone }, icone('i-telephone'), 'Appeler') : null,
      courriel ? el('a', { class: 'puce', href: courriel, title: f.courriel }, icone('i-courriel'), 'Écrire') : null) : null);
}

// options : { section, rappel } (voir ouvrirFiche)
export function ouvrirClient(id, options = {}) {
  const c = E.clients.find(x => String(x.client_id) === String(id));
  if (!c) return toast('Ce client n’est plus dans l’espace client.', true);
  if (E.vue !== 'clients') montrer('clients');
  ouvrirFiche(c, options);
}

// ─── Mot de passe et accès du client ───────────────────────────────────────
// Mot de passe lisible et solide : 12 caractères sans 0/O, 1/l/i.
function motDePasse() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const v = new Uint32Array(12);
  crypto.getRandomValues(v);
  const s = [...v].map(x => a[x % a.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
function messageAcces(identifiant, mdp) {
  return `Bonjour,\n\nVoici votre accès à l’espace client d’Agence UIO : votre service, votre forfait et le rapport de chaque mois.\n${ESPACE_CLIENT}\nNom d’utilisateur : ${identifiant}\nMot de passe : ${mdp}\n\nGardez-le précieusement : pour des raisons de sécurité, nous ne pouvons pas le revoir, seulement le remplacer.`;
}
function blocAcces(identifiant, mdp, titre) {
  const message = messageAcces(identifiant, mdp);
  return el('div', { class: 'acces', role: 'status' },
    el('b', null, titre),
    el('pre', null, `Nom d’utilisateur : ${identifiant}\nMot de passe : ${mdp}`),
    el('p', { class: 'champ__aide' }, 'Ce mot de passe ne sera plus jamais affiché. Copie le message prêt à envoyer au client maintenant.'),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn--petit', type: 'button', onclick: async () => toast(await copier(message) ? 'Message copié.' : 'Copie impossible : sélectionne le texte.', false) }, 'Copier le message pour le client'),
      el('button', { class: 'puce', type: 'button', onclick: async () => toast(await copier(mdp) ? 'Mot de passe copié.' : 'Copie impossible.') }, 'Copier le mot de passe')));
}

export function blocMotDePasse(c) {
  const bloc = el('div', { class: 'bloc' }, el('h4', null, 'Mot de passe du client'),
    el('p', null, 'Personne ne peut relire un mot de passe : il est gardé chiffré. Si le client l’a perdu, donne-lui-en un nouveau.'));
  const zone = el('div', { class: 'bloc' });
  const debut = el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => {
    debut.hidden = true;
    const champ = el('input', { id: 'p-mdp', type: 'text', value: motDePasse(), autocomplete: 'new-password', spellcheck: 'false' });
    const erreur = el('p', { class: 'erreur', role: 'alert' });
    const valider = el('button', { class: 'btn btn--petit', type: 'button', onclick: async () => {
      const mdp = champ.value.trim();
      if (mdp.length < 8) { erreur.textContent = 'Au moins 8 caractères.'; return; }
      valider.disabled = true; valider.textContent = 'Remplacement…'; erreur.textContent = '';
      try {
        await api('/portal/admin/mot_de_passe', { methode: 'POST', corps: { client_id: c.client_id, password: mdp } });
        vider(zone, blocAcces(c.username, mdp, 'Nouveau mot de passe enregistré.'));
      } catch (e) {
        if (e.statut === 401) return;
        erreur.textContent = e.statut === 404 ? 'Le serveur n’a pas encore cette fonction : il faut d’abord le mettre à jour.' : e.message;
        valider.disabled = false; valider.textContent = 'Remplacer le mot de passe';
      }
    } }, 'Remplacer le mot de passe');
    vider(zone, el('div', { class: 'champ' }, el('label', { for: 'p-mdp' }, 'Nouveau mot de passe'),
      el('div', { class: 'champ__ligne' }, champ, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { champ.value = motDePasse(); } }, 'Autre'))),
      el('div', { class: 'actions' }, valider, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { vider(zone); debut.hidden = false; debut.focus(); } }, 'Annuler')), erreur);
    champ.focus(); champ.select();
  } }, 'Donner un nouveau mot de passe');
  bloc.append(debut, zone);
  return bloc;
}

// ─── Nouveau client ────────────────────────────────────────────────────────
// Son accès à l'espace client, puis sa fiche (« Mise en place »), avec ses coordonnées si on les a.
// options : { projet, courriel, telephone, site, metier, quandCree } quand un prospect signé devient
// client (le prospect garde le lien vers son espace client). Appelé par un bouton : options est l'événement.
const COURRIEL_RE = /^[^\s@<>"'(),;:]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export function ouvrirNouveau(options) {
  const o = options && !(options instanceof Event) ? options : {};
  const quandCree = typeof o.quandCree === 'function' ? o.quandCree : null;
  if (E.vue !== 'clients') montrer('clients');
  const donnees = { project_name: '', client_id: '', username: '', password: motDePasse(), demo_url: '' };
  const fiche = { contact: '', courriel: String(o.courriel || '').trim(), telephone: String(o.telephone || '').trim() };
  let idTouche = false, userTouche = false;
  const etat = { type: 'nouveau', donnees, modifie: () => !!(donnees.project_name || donnees.demo_url || fiche.contact) && !etat.cree };
  const slug = s => normal(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const champ = (id, libelle, attrs, aide, facultatif = false) => el('div', { class: 'champ' },
    el('span', { class: 'champ__etiquette' }, el('label', { for: id }, libelle), facultatif ? el('span', { class: 'facultatif' }, ' (facultatif)') : null),
    el('input', { id, type: 'text', ...attrs }), aide && el('p', { class: 'champ__aide' }, aide));
  const projet = champ('n-projet', 'Nom du client', { placeholder: 'Ex. : Plomberie Côté', autocomplete: 'off', maxlength: 100 });
  const ident = champ('n-id', 'ID client', { placeholder: 'plomberie-cote', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' }, 'Lettres, chiffres et tirets. Ne change plus ensuite.');
  const user = champ('n-user', 'Nom d’utilisateur', { placeholder: 'plomberie-cote', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' }, 'Ce que le client tape pour se connecter.');
  const mdp = el('div', { class: 'champ' }, el('label', { for: 'n-mdp' }, 'Mot de passe'),
    el('div', { class: 'champ__ligne' }, el('input', { id: 'n-mdp', type: 'text', value: donnees.password, autocomplete: 'new-password', spellcheck: 'false' }),
      el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { donnees.password = motDePasse(); $('#n-mdp').value = donnees.password; } }, 'Autre')),
    el('p', { class: 'champ__aide' }, 'Généré pour toi. Tu pourras copier le message à envoyer au client juste après.'));
  const contact = champ('n-contact', 'Personne-contact', { placeholder: 'Ex. : Marc Côté', autocomplete: 'off', maxlength: 80 }, '', true);
  const courriel = champ('n-courriel', 'Courriel', { type: 'email', inputmode: 'email', placeholder: 'marc@plomberiecote.ca', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', maxlength: 120, value: fiche.courriel || null },
    'Pour son rappel de paiement et son rapport du mois.', true);
  const telephone = champ('n-tel', 'Téléphone', { type: 'tel', inputmode: 'tel', placeholder: '819 555-0142', autocomplete: 'off', maxlength: 40, value: fiche.telephone || null }, '', true);
  const demo = champ('n-demo', 'Lien de la démo', { type: 'url', placeholder: 'https://…', inputmode: 'url', spellcheck: 'false', autocapitalize: 'none' }, '', true);
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const creer = el('button', { class: 'btn', type: 'button' }, 'Créer le client');
  const corps = [el('div', { class: 'deux' }, projet, ident), el('div', { class: 'deux' }, user, mdp),
    el('div', { class: 'bloc' }, el('h3', null, 'Sa fiche'), el('p', null, 'Il commence « En mise en place ». Le reste (forfait, factures, documents, notes) se remplit dans sa fiche.'),
      contact, el('div', { class: 'deux' }, courriel, telephone)),
    demo, erreur];
  ouvrirPanneau(etat, 'Nouveau client', 'Son accès à l’espace client et sa fiche.', corps,
    [el('button', { class: 'btn btn--discret ml-auto', type: 'button', onclick: () => fermerPanneau() }, 'Annuler'), creer]);
  etat.focus = () => $('#n-projet');
  const iProjet = $('#n-projet'), iId = $('#n-id'), iUser = $('#n-user'), iMdp = $('#n-mdp'), iDemo = $('#n-demo');
  const iContact = $('#n-contact'), iCourriel = $('#n-courriel'), iTel = $('#n-tel');
  iProjet.addEventListener('input', () => {
    donnees.project_name = iProjet.value.trim();
    if (!idTouche) iId.value = donnees.client_id = slug(iProjet.value);
    if (!userTouche) iUser.value = donnees.username = slug(iProjet.value);
  });
  iId.addEventListener('input', () => { idTouche = true; donnees.client_id = iId.value.trim(); });
  iUser.addEventListener('input', () => { userTouche = true; donnees.username = iUser.value.trim(); });
  iMdp.addEventListener('input', () => { donnees.password = iMdp.value.trim(); });
  iDemo.addEventListener('input', () => { donnees.demo_url = iDemo.value.trim(); });
  iContact.addEventListener('input', () => { fiche.contact = iContact.value.trim(); });
  iCourriel.addEventListener('input', () => { fiche.courriel = iCourriel.value.trim(); });
  iTel.addEventListener('input', () => { fiche.telephone = iTel.value.trim(); });
  if (o.projet) { iProjet.value = String(o.projet).slice(0, 100); iProjet.dispatchEvent(new Event('input')); }
  const envoyer = async () => {
    if (etat.envoi || etat.cree) return;
    erreur.textContent = '';
    if (!donnees.project_name || !donnees.client_id || !donnees.username) { erreur.textContent = 'Il faut le nom du client, l’ID et le nom d’utilisateur.'; return; }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(donnees.client_id)) { erreur.textContent = 'L’ID ne garde que des lettres, des chiffres et des tirets.'; iId.focus(); return; }
    if (donnees.password.length < 8) { erreur.textContent = 'Le mot de passe doit avoir au moins 8 caractères.'; iMdp.focus(); return; }
    if (fiche.courriel && !COURRIEL_RE.test(fiche.courriel)) { erreur.textContent = 'Le courriel est illisible (ex. : marc@plomberiecote.ca).'; iCourriel.focus(); return; }
    if (fiche.telephone && fiche.telephone.replace(/\D/g, '').length < 10) { erreur.textContent = 'Le téléphone est illisible (ex. : 819 555-0142).'; iTel.focus(); return; }
    if (donnees.demo_url && !urlSure(donnees.demo_url)) { erreur.textContent = 'Le lien de la démo doit commencer par https://'; iDemo.focus(); return; }
    etat.envoi = true;
    creer.disabled = true; creer.textContent = 'Création…';
    try {
      await api('/portal/admin/add_client', { methode: 'POST', corps: donnees });
    } catch (e) {
      etat.envoi = false;
      if (e.statut !== 401) erreur.textContent = e.message === 'Username déjà utilisé' ? 'Ce nom d’utilisateur est déjà pris.' : e.message === 'ID client déjà utilisé' ? 'Cet ID est déjà pris.' : e.message;
      creer.disabled = false; creer.textContent = 'Créer le client';
      return;
    }
    etat.cree = true;
    if (quandCree) { try { await quandCree(donnees.client_id); } catch (e) { /* le client existe quand même */ } }
    // Sa fiche : seulement ce qui est écrit (celle d'un prospect garde le courriel et le téléphone du prospect)
    let suite = 'Sa fiche est prête : ouvre-la pour ajouter son abonnement, ses documents et tes notes.';
    const corpsFiche = { client: donnees.client_id, statut: 'mise_en_place', ...Object.fromEntries(Object.entries(fiche).filter(([, x]) => x)) };
    try {
      const r = await api('/portal/admin/fiche', { methode: 'POST', corps: corpsFiche, delai: 60000 });
      garderFiches(r);
    } catch (e) {
      if (e.statut === 401) return;
      suite = e.statut === 404 ? 'Sa fiche s’affichera dès que le serveur aura reçu sa mise à jour.'
        : 'Le client est créé, mais sa fiche n’a pas pu être écrite : ouvre-le dans la liste pour la remplir.';
    }
    const lecture = chargerClients();
    const ouvrir = el('button', { class: 'btn', type: 'button', onclick: async () => {
      ouvrir.disabled = true;
      await lecture;
      fermerPanneau(true);
      ouvrirClient(donnees.client_id);
    } }, 'Ouvrir sa fiche');
    vider($('#panneau-corps'), blocAcces(donnees.username, donnees.password, `${donnees.project_name} est créé.`),
      el('p', { class: 'champ__aide' }, suite));
    vider($('#panneau-pied'), el('button', { class: 'btn btn--discret ml-auto', type: 'button', onclick: () => fermerPanneau(true) }, 'Terminé'), ouvrir);
  };
  creer.addEventListener('click', envoyer);
  etat.enregistrer = envoyer;
  $('#panneau-corps').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio' && E.panneau === etat && !etat.cree) { e.preventDefault(); envoyer(); } });
}
