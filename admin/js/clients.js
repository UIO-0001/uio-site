// Clients : la liste, le panneau d'un client (progression, étapes, note, mot de passe), un nouveau client.
import { $, $$, el, icone, vider, nombre, pluriel, urlSure, toast, copier, normal } from './outils.js';
import { E, ESPACE_CLIENT } from './etat.js';
import { api } from './api.js';
import { gros, rendreBonjour } from './tableau.js';
import { montrer } from './navigation.js';
import { ouvrirPanneau, fermerPanneau } from './panneau.js';

export async function chargerClients(auto = false) {
  if (auto && E.panneau && E.panneau.modifie()) return;   // ne jamais écraser une modification en cours
  try {
    const d = await api('/portal/admin/clients', { delai: 80000 });
    E.clients = Array.isArray(d.clients) ? d.clients : [];
    E.fonctionnalites = Array.isArray(d.available_features) ? d.available_features : [];
    E.clientsErreur = ''; E.clientsLus = true;
  } catch (e) {
    if (e.statut === 401) return;
    E.clientsErreur = e.message;
  }
  rendreClients(); rendrePortail(); rendreBonjour();
}

export function rendrePortail() {
  const boite = $('#portail');
  if (!E.clientsLus) return vider(boite, el('p', { class: 'vide' }, E.clientsErreur || 'Lecture en cours…'));
  const n = E.clients.length;
  const enCours = E.clients.filter(c => (parseInt(c.progress, 10) || 0) < 100);
  const finis = n - enCours.length;
  const blocs = [gros(n, n >= 2 ? 'clients' : 'client',
    [pluriel(enCours.length, 'projet', 'projets')], ' en cours, ', [nombre(finis)], finis >= 2 ? ' terminés.' : ' terminé.')];
  if (!n) blocs.push(el('p', { class: 'vide' }, 'Aucun client pour l’instant. Ajoute le premier dans Clients.'));
  else blocs.push(el('div', { class: 'raccourcis' }, [...E.clients].sort((a, b) => (parseInt(a.progress, 10) || 0) - (parseInt(b.progress, 10) || 0)).slice(0, 5).map(c => {
    const pct = Math.max(0, Math.min(100, parseInt(c.progress, 10) || 0));
    return el('button', { class: 'raccourci raccourci--bouton', type: 'button', onclick: () => ouvrirClient(c.client_id) },
      el('b', null, c.project_name || c.client_id),
      el('span', { class: 'jauge-ligne pleine-largeur' }, el('span', { class: 'jauge', role: 'img', 'aria-label': `Progression ${pct} %` }, el('i', { style: `width:${pct}%` })), el('b', null, `${pct} %`)));
  })));
  vider(boite, blocs);
}

export function rendreClients() {
  const boite = $('#clients-liste');
  const n = E.clientsLus ? String(E.clients.length) : '';
  if (E.sousClients !== 'prospects') $('#clients-compte').textContent = n;   // sinon : le nombre de prospects
  if ($('#n-clients')) $('#n-clients').textContent = n;
  if (!E.clientsLus) return vider(boite, el('p', { class: 'vide' }, E.clientsErreur || 'Lecture en cours…'));
  const q = normal(E.recherche);
  const liste = E.clients.filter(c => !q || normal(`${c.project_name} ${c.client_id} ${c.username}`).includes(q));
  if (!E.clients.length) return vider(boite, el('p', { class: 'vide' }, 'Aucun client pour l’instant. ', el('b', null, 'Nouveau client'), ' crée son accès à l’espace client.'));
  if (!liste.length) return vider(boite, el('p', { class: 'vide' }, `Aucun client ne correspond à « ${E.recherche} ».`));
  vider(boite, liste.map(c => {
    const pct = Math.max(0, Math.min(100, parseInt(c.progress, 10) || 0));
    const etapes = Array.isArray(c.checklist) ? c.checklist : [];
    const faites = etapes.filter(e => e && e.done).length;
    const suivante = etapes.find(e => e && !e.done);
    const actives = E.fonctionnalites.filter(f => c.features && c.features[f.key]);
    return el('button', { class: 'client', type: 'button', 'data-id': c.client_id, onclick: () => ouvrirClient(c.client_id) },
      el('span', { class: 'client__haut' }, el('span', { class: 'client__nom' }, c.project_name || c.client_id), el('span', { class: 'client__pct' }, `${pct} %`)),
      el('span', { class: 'jauge', role: 'img', 'aria-label': `Progression ${pct} %` }, el('i', { style: `width:${pct}%` })),
      el('span', { class: 'client__meta' }, el('span', null, `@${c.username}`), el('span', null, `ID ${c.client_id}`), actives.map(f => el('span', { class: 'marque' }, f.label))),
      etapes.length ? el('span', { class: 'client__etapes' }, `${faites} étape${faites > 1 ? 's' : ''} sur ${etapes.length}`, suivante ? [' · ensuite : ', el('b', null, suivante.label)] : ' · tout est fait') : null);
  }));
}

export function ouvrirClient(id) {
  const c = E.clients.find(x => String(x.client_id) === String(id));
  if (!c) return;
  if (E.vue !== 'clients') montrer('clients');
  const donnees = {
    progress: Math.max(0, Math.min(100, parseInt(c.progress, 10) || 0)),
    demo_url: c.demo_url || '',
    notes: c.notes || '',
    checklist: (Array.isArray(c.checklist) ? c.checklist : []).filter(e => e && e.label).map(e => ({ label: String(e.label), done: !!e.done })),
    features: Object.fromEntries(E.fonctionnalites.map(f => [f.key, !!(c.features && c.features[f.key])]))
  };
  const initial = JSON.stringify(donnees);
  const etat = { type: 'client', id: c.client_id, donnees, modifie: () => JSON.stringify(donnees) !== initial };

  const marque = el('span', { class: 'modif', hidden: true }, 'Changements non enregistrés');
  const enregistrer = el('button', { class: 'btn', type: 'button', disabled: true, onclick: () => enregistrerClient(etat) }, 'Enregistrer');
  etat.majPied = () => { const m = etat.modifie(); marque.hidden = !m; enregistrer.disabled = !m || etat.envoi; };
  etat.enregistrer = () => enregistrerClient(etat);
  etat.boutonEnregistrer = enregistrer;
  const change = () => etat.majPied();

  // Progression
  const sortie = el('output', { for: 'p-progres' }, `${donnees.progress} %`);
  const curseur = el('input', { id: 'p-progres', type: 'range', min: 0, max: 100, step: 5, value: donnees.progress, style: `--p:${donnees.progress}%`,
    oninput: e => { donnees.progress = Number(e.target.value); e.target.style.setProperty('--p', `${donnees.progress}%`); sortie.textContent = `${donnees.progress} %`; change(); } });
  // Lien de la démo
  const ouvrirDemo = el('a', { class: 'btn btn--contour btn--petit', target: '_blank', rel: 'noopener' }, 'Ouvrir');
  const majDemo = () => { const u = urlSure(donnees.demo_url); ouvrirDemo.hidden = !u; if (u) ouvrirDemo.href = u; };
  const demo = el('input', { id: 'p-demo', type: 'url', value: donnees.demo_url, placeholder: 'https://…', inputmode: 'url',
    oninput: e => { donnees.demo_url = e.target.value.trim(); majDemo(); change(); } });
  majDemo();
  // Note
  const compte = el('span', { class: 'champ__aide' });
  const majCompte = () => { compte.textContent = `${donnees.notes.length} caractères. Le client la voit dans son espace.`; };
  const note = el('textarea', { id: 'p-note', placeholder: 'Ex. : on attend vos photos pour terminer la page d’accueil.',
    oninput: e => { donnees.notes = e.target.value; majCompte(); change(); } }, donnees.notes);
  majCompte();
  // Étapes
  const etapes = el('ul', { class: 'etapes', 'aria-label': 'Étapes du projet' });
  const dessinerEtapes = () => {
    vider(etapes, editeurEtapes(donnees.checklist, () => { dessinerEtapes(); change(); }, change));
    requestAnimationFrame(() => $$('textarea', etapes).forEach(ajusterHauteur));
  };
  dessinerEtapes();
  const nouvelle = el('input', { type: 'text', placeholder: 'Ajouter une étape', 'aria-label': 'Nouvelle étape',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); ajouterEtape(); } } });
  const ajouterEtape = () => { const t = nouvelle.value.trim(); if (!t) return; donnees.checklist.push({ label: t, done: false }); nouvelle.value = ''; dessinerEtapes(); change(); nouvelle.focus(); };
  // Fonctionnalités
  const fonctions = E.fonctionnalites.map(f => el('label', { class: 'interrupteur' },
    el('span', null, el('b', null, f.label), f.desc && el('span', null, f.desc)),
    el('input', { type: 'checkbox', role: 'switch', checked: donnees.features[f.key], onchange: e => { donnees.features[f.key] = e.target.checked; change(); } })));

  const corps = [
    el('div', { class: 'bloc' }, el('h3', null, 'Progression'), el('div', { class: 'progres' }, el('label', { class: 'sr', for: 'p-progres' }, 'Progression du projet'), curseur, sortie)),
    el('div', { class: 'champ' }, el('label', { for: 'p-demo' }, 'Lien de la démo'), el('div', { class: 'champ__ligne' }, demo, ouvrirDemo)),
    el('div', { class: 'bloc' }, el('h3', null, 'Étapes'), el('p', null, 'Coche ce qui est fait. Glisse une étape, ou utilise les flèches, pour changer l’ordre.'), etapes,
      el('div', { class: 'ajout' }, nouvelle, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: ajouterEtape }, 'Ajouter'))),
    el('div', { class: 'champ' }, el('label', { for: 'p-note' }, 'Note pour le client'), note, compte),
    fonctions.length ? el('div', { class: 'bloc' }, el('h3', null, 'Fonctionnalités'), fonctions) : null,
    blocMotDePasse(c)
  ];
  etat.focus = () => curseur;
  ouvrirPanneau(etat, c.project_name || c.client_id, `@${c.username} · ID ${c.client_id}`, corps,
    [marque, el('button', { class: 'btn btn--discret', type: 'button', onclick: () => fermerPanneau() }, 'Fermer'), enregistrer]);
  etat.majPied();
}

// Un champ d'une ligne qui grandit avec son texte
const ajusterHauteur = t => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; };

// Éditeur d'étapes : case, texte, glisser-déposer, et flèches pour le clavier.
function editeurEtapes(liste, redessiner, change) {
  return liste.map((e, i) => {
    const ligne = el('li', { class: 'etape' + (e.done ? ' fait' : ''), draggable: 'true' });
    const coche = el('input', { type: 'checkbox', checked: e.done, 'aria-label': `Fait : ${e.label}`,
      onchange: ev => { e.done = ev.target.checked; ligne.classList.toggle('fait', e.done); change(); } });
    const texte = el('textarea', { rows: 1, 'aria-label': `Étape ${i + 1}`,
      oninput: ev => { ev.target.value = ev.target.value.replace(/\n/g, ' '); e.label = ev.target.value; ajusterHauteur(ev.target); change(); },
      onkeydown: ev => { if (ev.key === 'Enter') ev.preventDefault(); },
      onblur: ev => { if (!ev.target.value.trim()) { liste.splice(liste.indexOf(e), 1); redessiner(); } } });
    texte.value = e.label;
    const bouger = (de, vers) => { const [x] = liste.splice(de, 1); liste.splice(vers, 0, x); redessiner(); };
    ligne.append(
      el('span', { class: 'poignee', title: 'Glisser pour déplacer' }, icone('i-poignee')),
      coche, texte,
      el('span', { class: 'etape__outils' },
        el('button', { class: 'mini', type: 'button', disabled: i === 0, 'aria-label': `Monter « ${e.label} »`, onclick: () => bouger(i, i - 1) }, icone('i-haut')),
        el('button', { class: 'mini', type: 'button', disabled: i === liste.length - 1, 'aria-label': `Descendre « ${e.label} »`, onclick: () => bouger(i, i + 1) }, icone('i-bas')),
        el('button', { class: 'mini', type: 'button', 'aria-label': `Retirer « ${e.label} »`, onclick: () => { liste.splice(i, 1); redessiner(); } }, icone('i-fermer'))));
    ligne.addEventListener('dragstart', ev => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(i)); ligne.classList.add('glisse'); });
    ligne.addEventListener('dragend', () => ligne.classList.remove('glisse'));
    ligne.addEventListener('dragover', ev => { ev.preventDefault(); ligne.classList.add('dessus'); });
    ligne.addEventListener('dragleave', () => ligne.classList.remove('dessus'));
    ligne.addEventListener('drop', ev => {
      ev.preventDefault(); ligne.classList.remove('dessus');
      const de = Number(ev.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(de) && de !== i) bouger(de, i);
    });
    texte.addEventListener('mousedown', () => { ligne.draggable = false; });
    texte.addEventListener('mouseup', () => { ligne.draggable = true; });
    texte.addEventListener('blur', () => { ligne.draggable = true; });
    return ligne;
  });
}

async function enregistrerClient(etat) {
  if (!etat.modifie() || etat.envoi) return;
  const d = etat.donnees;
  d.checklist = d.checklist.map(e => ({ label: e.label.trim(), done: !!e.done })).filter(e => e.label);
  etat.envoi = true; etat.boutonEnregistrer.textContent = 'Enregistrement…'; etat.majPied();
  try {
    await api('/portal/admin/update', { methode: 'POST', corps: { client_id: etat.id, ...d } });
    const c = E.clients.find(x => String(x.client_id) === String(etat.id));
    if (c) Object.assign(c, JSON.parse(JSON.stringify(d)));
    toast('Enregistré. Le client le voit dès maintenant.');
    etat.envoi = false;
    fermerPanneau(true);
    rendreClients(); rendrePortail();
  } catch (e) {
    if (e.statut !== 401) toast(e.message, true);
    etat.envoi = false; etat.boutonEnregistrer.textContent = 'Enregistrer'; etat.majPied && etat.majPied();
  }
}

// Mot de passe lisible et solide : 12 caractères sans 0/O, 1/l/i.
function motDePasse() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const v = new Uint32Array(12);
  crypto.getRandomValues(v);
  const s = [...v].map(x => a[x % a.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
function messageAcces(identifiant, mdp) {
  return `Bonjour,\n\nVoici votre accès à l’espace client d’Agence UIO, pour suivre votre projet :\n${ESPACE_CLIENT}\nNom d’utilisateur : ${identifiant}\nMot de passe : ${mdp}\n\nGardez-le précieusement : pour des raisons de sécurité, nous ne pouvons pas le revoir, seulement le remplacer.`;
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

function blocMotDePasse(c) {
  const bloc = el('div', { class: 'bloc' }, el('h3', null, 'Mot de passe du client'),
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
        erreur.textContent = e.statut === 404 ? 'Le serveur n’a pas encore cette fonction : il faut d’abord le mettre à jour.' : e.message;
        valider.disabled = false; valider.textContent = 'Remplacer le mot de passe';
      }
    } }, 'Remplacer le mot de passe');
    vider(zone, el('div', { class: 'champ' }, el('label', { for: 'p-mdp' }, 'Nouveau mot de passe'),
      el('div', { class: 'champ__ligne' }, champ, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { champ.value = motDePasse(); } }, 'Autre'))),
      el('div', { class: 'actions' }, valider, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { vider(zone); debut.hidden = false; } }, 'Annuler')), erreur);
    champ.focus(); champ.select();
  } }, 'Donner un nouveau mot de passe');
  bloc.append(debut, zone);
  return bloc;
}

// Les étapes que le client voit dans son espace, selon son forfait. « Site web » garde
// les étapes de départ du serveur (structure, design, contenu…).
const DEPART = ['Appel de départ : vos services, vos heures et vos urgences', 'Script de l’agent répondeur écrit pour votre métier',
  'Votre numéro branché à l’agent répondeur', 'Urgences transférées à votre cellulaire'];
const CENTRE = ['Rendez-vous réservés dans votre agenda', 'Demandes d’avis Google après chaque travail', 'Courriels automatiques : relances et rappels'];
const MODELES = [
  { nom: 'Répondeur', etapes: [...DEPART, 'Appels d’essai avec vous', 'Mise en service', 'Premier suivi : appels écoutés et script ajusté'] },
  { nom: 'Croissance', etapes: [...DEPART, ...CENTRE, 'Appels d’essai avec vous', 'Mise en service', 'Premier rapport mensuel'] },
  { nom: 'Complet', etapes: [...DEPART, ...CENTRE, 'Structure et textes de votre site', 'Design et photos du site', 'Site bilingue en ligne sur votre domaine', 'Appels d’essai avec vous', 'Mise en service', 'Premier rapport mensuel'] },
  { nom: 'Site web', etapes: ['Structure du site', 'Design et couleurs', 'Contenu et textes', 'Photos et médias', 'SEO optimisé', 'Chatbot IA intégré', 'Tests mobile', 'Domaine connecté', 'Livraison finale'], serveur: true }
];

// options : { projet, quandCree } quand un prospect signé devient client (le nom est déjà écrit,
// et le prospect garde le lien vers son espace client). Appelé par un bouton : options est l'événement.
export function ouvrirNouveau(options) {
  const { projet: nomDuProjet = '', quandCree = null } = options && !(options instanceof Event) ? options : {};
  if (E.vue !== 'clients') montrer('clients');
  const donnees = { project_name: '', client_id: '', username: '', password: motDePasse(), demo_url: '' };
  let idTouche = false, userTouche = false;
  const etat = { type: 'nouveau', donnees, modifie: () => !!(donnees.project_name || donnees.demo_url) && !etat.cree };
  const slug = s => normal(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const champ = (id, libelle, attrs, aide) => el('div', { class: 'champ' }, el('label', { for: id }, libelle), el('input', { id, type: 'text', ...attrs }), aide && el('span', { class: 'champ__aide' }, aide));
  const projet = champ('n-projet', 'Nom du projet', { placeholder: 'Ex. : Plomberie Côté', autocomplete: 'off' });
  const ident = champ('n-id', 'ID client', { placeholder: 'plomberie-cote', autocomplete: 'off', spellcheck: 'false' }, 'Lettres, chiffres et tirets. Ne change plus ensuite.');
  const user = champ('n-user', 'Nom d’utilisateur', { placeholder: 'plomberie-cote', autocomplete: 'off', spellcheck: 'false' }, 'Ce que le client tape pour se connecter.');
  const mdp = el('div', { class: 'champ' }, el('label', { for: 'n-mdp' }, 'Mot de passe'),
    el('div', { class: 'champ__ligne' }, el('input', { id: 'n-mdp', type: 'text', value: donnees.password, autocomplete: 'new-password', spellcheck: 'false' }),
      el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { donnees.password = motDePasse(); $('#n-mdp').value = donnees.password; } }, 'Autre')),
    el('span', { class: 'champ__aide' }, 'Généré pour toi. Tu pourras copier le message à envoyer au client juste après.'));
  const demo = champ('n-demo', 'Lien de la démo (facultatif)', { type: 'url', placeholder: 'https://…', inputmode: 'url' });
  let modele = MODELES[0];
  const apercu = el('ol', { class: 'apercu-etapes', 'aria-label': 'Étapes de départ' });
  const majApercu = () => vider(apercu, modele.etapes.map(t => el('li', null, t)));
  majApercu();
  const forfait = el('fieldset', { class: 'choix' }, el('legend', null, 'Forfait'),
    el('div', { class: 'choix__liste' }, MODELES.map((m, i) => el('label', null,
      el('input', { type: 'radio', name: 'n-forfait', value: m.nom, checked: i === 0, onchange: () => { modele = m; majApercu(); } }),
      el('span', null, m.nom)))),
    el('p', { class: 'champ__aide' }, 'Les étapes que le client verra dans son espace. Tu pourras les changer ensuite.'), apercu);
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const creer = el('button', { class: 'btn', type: 'button' }, 'Créer le client');
  const corps = [el('div', { class: 'deux' }, projet, ident), el('div', { class: 'deux' }, user, mdp), demo, forfait, erreur];
  ouvrirPanneau(etat, 'Nouveau client', 'Son accès à l’espace client, avec les étapes de départ.', corps,
    [el('button', { class: 'btn btn--discret ml-auto', type: 'button', onclick: () => fermerPanneau() }, 'Annuler'), creer]);
  etat.focus = () => $('#n-projet');
  const iProjet = $('#n-projet'), iId = $('#n-id'), iUser = $('#n-user'), iMdp = $('#n-mdp'), iDemo = $('#n-demo');
  iProjet.addEventListener('input', () => {
    donnees.project_name = iProjet.value.trim();
    if (!idTouche) iId.value = donnees.client_id = slug(iProjet.value);
    if (!userTouche) iUser.value = donnees.username = slug(iProjet.value);
  });
  iId.addEventListener('input', () => { idTouche = true; donnees.client_id = iId.value.trim(); });
  iUser.addEventListener('input', () => { userTouche = true; donnees.username = iUser.value.trim(); });
  iMdp.addEventListener('input', () => { donnees.password = iMdp.value.trim(); });
  iDemo.addEventListener('input', () => { donnees.demo_url = iDemo.value.trim(); });
  if (nomDuProjet) { iProjet.value = String(nomDuProjet).slice(0, 100); iProjet.dispatchEvent(new Event('input')); }
  const envoyer = async () => {
    erreur.textContent = '';
    if (!donnees.project_name || !donnees.client_id || !donnees.username) { erreur.textContent = 'Il faut le nom du projet, l’ID et le nom d’utilisateur.'; return; }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(donnees.client_id)) { erreur.textContent = 'L’ID ne garde que des lettres, des chiffres et des tirets.'; iId.focus(); return; }
    if (donnees.password.length < 8) { erreur.textContent = 'Le mot de passe doit avoir au moins 8 caractères.'; iMdp.focus(); return; }
    if (donnees.demo_url && !urlSure(donnees.demo_url)) { erreur.textContent = 'Le lien de la démo doit commencer par https://'; iDemo.focus(); return; }
    creer.disabled = true; creer.textContent = 'Création…';
    try {
      await api('/portal/admin/add_client', { methode: 'POST', corps: donnees });
      etat.cree = true;
      if (quandCree) quandCree(donnees.client_id);
      let suite = `Il commence à 0 % avec les étapes du forfait ${modele.nom}. Ouvre-le dans la liste pour les ajuster.`;
      if (!modele.serveur) {
        try { await api('/portal/admin/update', { methode: 'POST', corps: { client_id: donnees.client_id, checklist: modele.etapes.map(label => ({ label, done: false })) } }); }
        catch (e) { if (e.statut === 401) return; suite = 'Le client est créé, mais ses étapes n’ont pas pu être mises : ouvre-le dans la liste pour les ajouter.'; }
      }
      vider($('#panneau-corps'), blocAcces(donnees.username, donnees.password, `${donnees.project_name} est créé.`),
        el('p', { class: 'champ__aide' }, suite));
      vider($('#panneau-pied'), el('button', { class: 'btn ml-auto', type: 'button', onclick: () => fermerPanneau(true) }, 'Terminé'));
      chargerClients();
    } catch (e) {
      if (e.statut !== 401) erreur.textContent = e.message === 'Username déjà utilisé' ? 'Ce nom d’utilisateur est déjà pris.' : e.message === 'ID client déjà utilisé' ? 'Cet ID est déjà pris.' : e.message;
      creer.disabled = false; creer.textContent = 'Créer le client';
    }
  };
  creer.addEventListener('click', envoyer);
  etat.enregistrer = envoyer;
  $('#panneau-corps').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio' && E.panneau === etat && !etat.cree) { e.preventDefault(); envoyer(); } });
}
