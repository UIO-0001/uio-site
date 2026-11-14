// Appels : une conversation par client, pour chaque ligne (l'agence, la démo, puis chaque client).
// Le serveur (uio-backend, conversations.py) regroupe par numéro de l'appelant ce qui arrivait
// mélangé dans une seule conversation du téléphone : les appels à l'agent répondeur (besoin,
// résumé, demande, suite), les appels manqués, les textos reçus avec leurs photos, les textos
// envoyés (automatiques ou réponses de l'équipe), les suivis prévus et le prochain rendez-vous.
// « À répondre » : le client attend quelque chose ; « C'est réglé » le retire de la pile.
// Répondre part du numéro du commerce, avec les mêmes règles que « 0142 message » par texto.
// Tout texte venu du serveur est inséré comme du texte (el, textContent), jamais comme du HTML.
import { $, el as brut, icone, vider, relatif, heure, ymd, jourLong, duree, toast, lire, ecrire, normal, lienTel, date, urlSure } from './outils.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { occuper } from './ui.js';
import { el, badge, nouvelleCle } from './formes.js';

const CLE_LIGNE = 'uio-admin-appels-ligne';
const MAX_TEXTE = 600;
const A = {
  construit: false, lignes: [], ligne: lire('localStorage', CLE_LIGNE) || '', vue: null, erreur: '', lu: 0, charge: null,
  filtre: 'tout', recherche: '', ouvert: '', fil: null, filErreur: '', filLu: 0, filCharge: null,
  brouillons: new Map(), cleEnvoi: '', basAvant: true
};

export const appelsLus = () => A.lu;
export const aRepondre = () => (A.vue ? A.vue.a_repondre || 0 : 0);

export function viderAppels() {
  Object.assign(A, { lignes: [], vue: null, erreur: '', lu: 0, filtre: 'tout', recherche: '', ouvert: '', fil: null, filErreur: '', filLu: 0, cleEnvoi: '' });
  A.brouillons.clear();
  const champ = $('#appels-chercher');
  if (champ) champ.value = '';
  if (A.construit) rendreAppels();
}

// ─── Lectures ──────────────────────────────────────────────────────────────
export function chargerAppels({ frais = false, auto = false } = {}) {
  if (!sessionActuelle()) return Promise.resolve();
  if (A.charge) return A.charge;
  A.charge = (async () => {
    const q = new URLSearchParams();
    if (A.ligne) q.set('ligne', A.ligne);
    if (frais) q.set('frais', '1');
    try {
      const r = await api('/portal/admin/conversations?' + q.toString());
      Object.assign(A, { lignes: r.lignes || [], ligne: r.ligne || '', vue: r, erreur: '', lu: Date.now() });
      ecrire('localStorage', CLE_LIGNE, A.ligne || null);
    } catch (e) {
      if (e.statut === 404) A.erreur = 'pas-encore';
      else if (e.statut === 400 && A.ligne) {             // la ligne gardée n'existe plus : la première
        A.ligne = ''; ecrire('localStorage', CLE_LIGNE, null);
        A.charge = null;
        return chargerAppels({ frais, auto });
      } else if (!auto || !A.vue) A.erreur = e.message;
    } finally { A.charge = null; }
    rendreAppels();
    if (A.ouvert && A.vue) chargerFil({ silencieux: true, frais });
  })();
  return A.charge;
}

function chargerFil({ silencieux = false, frais = false } = {}) {
  const numero = A.ouvert, ligne = A.ligne;
  if (!numero) return Promise.resolve();
  if (A.filCharge && A.filCharge.numero === numero && !frais) return A.filCharge.promesse;
  if (!silencieux) { A.fil = null; A.filErreur = ''; rendreFil(); }
  const promesse = (async () => {
    const q = new URLSearchParams({ ligne, numero });
    if (frais) q.set('frais', '1');
    try {
      const r = await api('/portal/admin/conversation?' + q.toString());
      if (A.ouvert !== numero || A.ligne !== ligne) return;
      Object.assign(A, { fil: r, filErreur: '', filLu: Date.now() });
    } catch (e) {
      if (A.ouvert !== numero) return;
      if (!silencieux || !A.fil) A.filErreur = e.message;
    } finally { if (A.filCharge && A.filCharge.numero === numero) A.filCharge = null; }
    rendreFil();
  })();
  A.filCharge = { numero, promesse };
  return promesse;
}

// ─── Petits outils ─────────────────────────────────────────────────────────
const convs = () => (A.vue && A.vue.conversations) || [];
const convDe = numero => convs().find(c => c.numero === numero) || (A.fil && A.fil.conversation && A.fil.conversation.numero === numero ? A.fil.conversation : null);
const nomDe = c => (c && c.prenom) || (c && c.tel) || 'Client';
const ligneActuelle = () => A.lignes.find(l => l.id === A.ligne) || null;
const cleBrouillon = () => `${A.ligne}|${A.ouvert}`;

function quandCourt(iso) {
  const d = date(iso);
  if (!d) return '';
  const r = relatif(d);
  return r.startsWith('aujourd’hui à ') ? r.slice('aujourd’hui à '.length) : r;
}
function jourDe(d) {
  const j = ymd(d), m = new Date();
  if (j === ymd(m)) return 'Aujourd’hui';
  if (j === ymd(new Date(m.getTime() - 864e5))) return 'Hier';
  if (j === ymd(new Date(m.getTime() + 864e5))) return 'Demain';
  const t = jourLong(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function filtrees() {
  const q = normal(A.recherche).trim(), chiffres = A.recherche.replace(/\D/g, '');
  return convs().filter(c => {
    if (A.filtre === 'attente' && !c.a_repondre) return false;
    if (A.filtre === 'urgence' && !c.urgence) return false;
    if (!q) return true;
    if (chiffres.length >= 3 && c.numero.replace(/\D/g, '').includes(chiffres)) return true;
    return normal(`${c.prenom} ${c.tel} ${c.apercu}`).includes(q);
  });
}

// ─── L'écran ───────────────────────────────────────────────────────────────
function construire() {
  if (A.construit) return;
  const s = $('#vue-appels');
  const champ = el('input', { id: 'appels-chercher', type: 'search', placeholder: 'Chercher un nom ou un numéro', autocomplete: 'off', enterkeyhint: 'search' });
  champ.addEventListener('input', () => { A.recherche = champ.value; rendreListe(); });
  vider(s,
    el('div', { class: 'clients__tete appels__tete' },
      el('h1', null, el('span', null, 'Appels'), el('small', { id: 'appels-compte' })),
      el('div', { class: 'recherche' }, el('label', { class: 'sr', for: 'appels-chercher' }, 'Chercher une conversation'), champ),
      el('button', { class: 'rond', type: 'button', id: 'appels-actualiser', 'aria-label': 'Relire les appels et les textos', title: 'Relire' }, icone('i-actualiser'))),
    el('p', { class: 'appels__phrase', id: 'appels-phrase' }),
    el('div', { class: 'appels__barre' },
      el('div', { class: 'filtres appels__lignes', id: 'appels-lignes', role: 'group', 'aria-label': 'Ligne' }),
      el('div', { class: 'filtres appels__filtres', id: 'appels-filtres', role: 'group', 'aria-label': 'Montrer' })),
    el('div', { class: 'appels', id: 'appels-cadre', 'data-ouvert': '0' },
      el('div', { class: 'appels__liste', id: 'appels-liste' }),
      el('section', { class: 'fil', id: 'appels-fil', 'aria-label': 'Conversation' })));
  $('#appels-actualiser').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.classList.add('tourne');
    await chargerAppels({ frais: true });
    b.classList.remove('tourne');
    toast(A.erreur ? A.erreur : 'Appels et textos relus.', !!A.erreur);
  });
  window.addEventListener('resize', ajusterHauteur, { passive: true });
  A.construit = true;
}

// Ordinateur : la liste et le fil prennent la hauteur qui reste (la zone de réponse toujours visible,
// au-dessus de la bulle de l'assistant)
function ajusterHauteur() {
  const cadre = $('#appels-cadre');
  if (!cadre || cadre.offsetParent === null) return;
  const haut = cadre.getBoundingClientRect().top + window.scrollY;
  cadre.style.setProperty('--appels-haut', Math.max(400, Math.round(window.innerHeight - haut - 92)) + 'px');
}

export function rendreAppels() {
  if (!$('#vue-appels')) return;                    // une page d'une version plus ancienne
  construire();
  rendreTete();
  rendreLignes();
  rendreFiltres();
  rendreListe();
  rendreFil();
  ajusterHauteur();
}

function rendreTete() {
  const v = A.vue, p = $('#appels-phrase'), compte = $('#appels-compte');
  compte.textContent = v ? String(convs().length) : '';
  if (!v) {
    p.textContent = A.erreur === 'pas-encore' ? 'Bientôt : le serveur doit d’abord recevoir sa mise à jour.' : (A.erreur || 'Lecture des appels et des textos…');
    return;
  }
  const manque = [];
  if (v.appels && v.appels.disponible === false) manque.push('les appels de l’agent');
  if (v.textos && v.textos.disponible === false && v.textos.raison !== 'Aucun numéro Twilio pour ce commerce') manque.push('les textos');
  p.textContent = manque.length ? `Pour l’instant, ${manque.join(' et ')} ne se lisent pas : réessaie dans une minute.` : '';
  p.classList.toggle('appels__manque', manque.length > 0);
}

function rendreLignes() {
  const boite = $('#appels-lignes');
  boite.hidden = A.lignes.length < 2;
  vider(boite, A.lignes.map(l => {
    const b = el('button', { class: 'filtre', type: 'button', 'aria-pressed': String(l.id === A.ligne) },
      l.nom + (l.demo ? ' (démo)' : ''), l.numero ? el('span', { class: 'filtre__n filtre__n--texte' }, l.numero) : null);
    b.addEventListener('click', () => {
      if (l.id === A.ligne) return;
      Object.assign(A, { ligne: l.id, vue: null, ouvert: '', fil: null, filtre: 'tout' });
      ecrire('localStorage', CLE_LIGNE, l.id);
      rendreAppels();
      chargerAppels();
    });
    return b;
  }));
}

function rendreFiltres() {
  const boite = $('#appels-filtres');
  const toutes = convs();
  const n = { tout: toutes.length, attente: toutes.filter(c => c.a_repondre).length, urgence: toutes.filter(c => c.urgence).length };
  const options = [['tout', 'Tous'], ['attente', 'À répondre'], ['urgence', 'Urgences']];
  vider(boite, options.filter(([cle]) => cle !== 'urgence' || n.urgence || A.filtre === 'urgence').map(([cle, nom]) => {
    const b = el('button', { class: 'filtre' + (cle === 'attente' && n.attente ? ' filtre--attente' : ''), type: 'button', 'aria-pressed': String(A.filtre === cle) },
      nom, A.vue ? el('span', { class: 'filtre__n' }, String(n[cle])) : null);
    b.addEventListener('click', () => { A.filtre = cle; rendreFiltres(); rendreListe(); });
    return b;
  }));
}

function rendreListe() {
  const boite = $('#appels-liste');
  if (!A.vue) {
    vider(boite, el('p', { class: 'vide' }, A.erreur === 'pas-encore'
      ? 'Les conversations s’afficheront ici dès que le serveur aura reçu sa mise à jour.' : (A.erreur || 'Lecture en cours…')));
    return;
  }
  const liste = filtrees();
  if (!liste.length) {
    const phrase = A.recherche ? 'Aucune conversation ne correspond.'
      : A.filtre === 'attente' ? 'Personne n’attend de réponse. Bravo !'
        : A.filtre === 'urgence' ? 'Aucune urgence ces 7 derniers jours.'
          : 'Aucun appel ni texto sur cette ligne depuis 30 jours.';
    vider(boite, el('p', { class: 'vide' }, phrase));
    return;
  }
  vider(boite, el('ul', { class: 'convs' }, liste.map(itemConv)));
}

function itemConv(c) {
  const actif = A.ouvert === c.numero;
  const b = el('button', { class: 'conv' + (c.a_repondre ? ' conv--attend' : ''), type: 'button', 'aria-current': actif ? 'true' : null, 'data-focus': 'conv-' + c.numero },
    el('span', { class: 'conv__avatar' + (c.urgence ? ' conv__avatar--urgence' : ''), 'aria-hidden': 'true' },
      c.prenom ? c.prenom.charAt(0).toUpperCase() : icone('i-appel')),
    el('span', { class: 'conv__texte' },
      el('span', { class: 'conv__haut' },
        el('b', { class: 'conv__nom' }, nomDe(c)),
        el('time', { class: 'conv__quand', datetime: c.dernier }, quandCourt(c.dernier))),
      c.prenom ? el('span', { class: 'conv__tel' }, c.tel) : null,
      brut('span', { class: 'conv__apercu' }, c.apercu)),
    el('span', { class: 'conv__marques' },
      c.a_repondre ? el('span', { class: 'conv__point' }, el('span', { class: 'sr' }, 'À répondre')) : null,
      c.urgence ? badge('Urgence', 'alerte') : null,
      c.rdv ? badge('Rendez-vous', 'bleu') : null,
      c.arret ? badge('ARRÊT', 'neutre') : null));
  b.addEventListener('click', () => ouvrir(c.numero));
  return el('li', null, b);
}

export function ouvrir(numero) {
  if (A.ouvert === numero) { $('#fil-texte') && $('#fil-texte').focus(); return; }
  Object.assign(A, { ouvert: numero, fil: null, filErreur: '', cleEnvoi: '', basAvant: true });
  rendreListe();
  rendreFil();
  chargerFil();
  if (matchMedia('(max-width: 899px)').matches) window.scrollTo({ top: 0 });
}

function fermer() {
  const numero = A.ouvert;
  Object.assign(A, { ouvert: '', fil: null, filErreur: '' });
  rendreListe();
  rendreFil();
  const b = $(`[data-focus="conv-${CSS.escape(numero)}"]`);
  if (b) b.focus({ preventScroll: false });
}

// ─── Le fil d'un client ────────────────────────────────────────────────────
function rendreFil() {
  const s = $('#appels-fil'), cadre = $('#appels-cadre');
  cadre.dataset.ouvert = A.ouvert ? '1' : '0';
  $('#vue-appels').dataset.ouvert = A.ouvert ? '1' : '0';
  if (!A.ouvert) {
    delete s.dataset.numero;
    vider(s, el('div', { class: 'fil__rien' }, icone('i-appel'), el('p', null, convs().length ? 'Choisis une conversation à gauche.' : 'Les conversations de cette ligne s’afficheront ici.')));
    return;
  }
  const c = convDe(A.ouvert) || { numero: A.ouvert, tel: A.ouvert, prenom: '' };
  const memeFil = s.dataset.numero === `${A.ligne}|${A.ouvert}`;
  const liste = memeFil ? $('.fil__evenements', s) : null;
  if (liste) A.basAvant = liste.scrollHeight - liste.scrollTop - liste.clientHeight < 80;
  const tete = teteDuFil(c);
  const corps = el('ol', { class: 'fil__evenements', 'aria-label': `Appels et textos avec ${nomDe(c)}` }, evenementsDuFil(c));
  const ancienPied = memeFil ? $('.fil__pied', s) : null;
  if (ancienPied && $('.fil__tete', s) && liste) {
    // Le même fil : seuls la tête et les événements changent, la zone de réponse garde le focus et le texte
    s.replaceChild(tete, $('.fil__tete', s));
    s.replaceChild(corps, liste);
    majPied(ancienPied, c);
  } else {
    s.dataset.numero = `${A.ligne}|${A.ouvert}`;
    vider(s, tete, corps, piedDuFil(c));
  }
  if (A.basAvant) corps.scrollTop = corps.scrollHeight;
}

function teteDuFil(c) {
  const retour = el('button', { class: 'rond fil__retour', type: 'button', 'aria-label': 'Retour aux conversations' }, icone('i-retour'));
  retour.addEventListener('click', fermer);
  const tel = lienTel(c.numero);
  const infos = [tel ? el('a', { class: 'fil__tel', href: tel }, c.tel || c.numero) : el('span', null, c.tel)];
  if (c.rdv) infos.push(el('span', null, `Rendez-vous ${c.rdv}`));
  if (c.anglais) infos.push(el('span', null, 'Anglais'));
  const actions = el('div', { class: 'fil__actions' });
  if (c.a_repondre) {
    const b = el('button', { class: 'btn btn--petit btn--contour', type: 'button' }, icone('i-ok'), 'C’est réglé');
    b.addEventListener('click', () => regler(true, b));
    actions.append(b);
  } else if (c.reglee) {
    const b = el('button', { class: 'lien lien--petit', type: 'button' }, 'Remettre à répondre');
    b.addEventListener('click', () => regler(false, b));
    actions.append(el('span', { class: 'badge badge--neutre' }, 'Réglée'), b);
  }
  return el('header', { class: 'fil__tete' }, retour,
    el('span', { class: 'conv__avatar' + (c.urgence ? ' conv__avatar--urgence' : ''), 'aria-hidden': 'true' }, c.prenom ? c.prenom.charAt(0).toUpperCase() : icone('i-appel')),
    el('div', { class: 'fil__qui' }, el('h2', { tabindex: '-1' }, nomDe(c)), el('p', { class: 'fil__infos' }, infos)),
    actions);
}

function evenementsDuFil(c) {
  if (A.filErreur) return [el('li', { class: 'vide' }, A.filErreur)];
  if (!A.fil) return [el('li', { class: 'fil__lecture' }, el('span', { class: 'roue', 'aria-hidden': 'true' }), el('span', null, 'Lecture du fil…'))];
  const evs = A.fil.evenements || [];
  if (!evs.length) return [el('li', { class: 'vide' }, 'Rien de ce numéro depuis 30 jours.')];
  const sortie = [];
  let jour = '';
  for (const ev of evs) {
    const d = date(ev.quand);
    const j = d ? ymd(d) : '';
    if (j && j !== jour) { jour = j; sortie.push(el('li', { class: 'fil__jour' }, el('span', null, jourDe(d)))); }
    sortie.push(evenement(ev, c, d));
  }
  return sortie;
}

const moment = (d, plus = '') => el('time', { class: 'fil__heure', datetime: d ? d.toISOString() : null }, (d ? heure(d) : '') + plus);

function evenement(ev, c, d) {
  if (ev.sorte === 'recu') {
    const photos = (ev.liens || []).filter(p => urlSure(p.url)).map(p => p.video
      ? el('a', { class: 'bulle__video', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir la vidéo')
      : el('a', { class: 'bulle__photo', href: p.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Photo de ${nomDe(c)} (ouvrir en grand)` },
        el('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })));
    const manque = ev.photos && !photos.length ? el('p', { class: 'bulle__note' }, ev.photos > 1 ? `${ev.photos} photos (pas encore lisibles)` : 'Une photo (pas encore lisible)') : null;
    return el('li', { class: 'bulle bulle--recu' },
      ev.texte ? brut('p', { class: 'bulle__texte' }, ev.texte) : null,
      photos.length ? el('div', { class: 'bulle__photos' }, photos) : null, manque, moment(d));
  }
  if (ev.sorte === 'envoye') {
    return el('li', { class: 'bulle bulle--envoye' + (ev.auto ? ' bulle--auto' : '') + (ev.echec ? ' bulle--echec' : '') },
      el('span', { class: 'bulle__qui' }, ev.auto ? 'Texto automatique' : 'Réponse'),
      brut('p', { class: 'bulle__texte' }, ev.texte),
      moment(d, ev.statut ? ` · ${ev.statut}` : ''));
  }
  if (ev.sorte === 'appel') {
    const lien = ev.lien && urlSure(ev.lien);
    return el('li', { class: `evt evt--appel evt--${ev.ton || 'info'}` },
      el('div', { class: 'evt__tete' }, el('span', { class: 'evt__icone', 'aria-hidden': 'true' }, icone('i-appel')),
        el('b', null, ev.secondes ? `Appel de ${duree(ev.secondes)}` : 'Appel'),
        ev.etiquette ? badge(ev.etiquette, ev.ton === 'urgence' ? 'alerte' : ev.ton === 'rdv' ? 'bleu' : ev.ton === 'rappel' ? 'attente' : 'neutre') : null,
        ev.anglais ? badge('Anglais', 'neutre') : null,
        moment(d)),
      ev.besoin ? brut('p', { class: 'evt__besoin' }, ev.besoin) : null,
      ev.resume ? brut('p', { class: 'evt__resume' }, ev.resume) : null,
      ev.demande ? el('p', { class: 'evt__demande' }, el('b', null, 'Demande : '), brut('span', null, ev.demande)) : null,
      el('p', { class: 'evt__suite' }, ev.suite || ''),
      lien ? el('a', { class: 'lien lien--petit evt__lien', href: lien, target: '_blank', rel: 'noopener' }, 'Écouter dans Retell') : null);
  }
  if (ev.sorte === 'manque') {
    return el('li', { class: 'evt evt--petit' }, el('span', { class: 'evt__icone', 'aria-hidden': 'true' }, icone('i-appel')),
      el('span', null, 'Appel manqué : raccroché pendant le message d’accueil'), moment(d));
  }
  if (ev.sorte === 'suivi') {
    const f = /^(Relance|Demande)/.test(ev.libelle || '') ? 'e' : '';          // « Relance prévue », « Rappel prévu »
    const etat = { prevu: `prévu${f}`, envoye: `envoyé${f}`, annule: `annulé${f}`, echec: `pas parti${f}` }[ev.etat] || ev.etat;
    const quand = ev.etat === 'prevu' && d ? ` ${relatif(d)}` : '';
    const ligne = el('li', { class: `evt evt--petit evt--suivi evt--${ev.etat}` }, el('span', { class: 'evt__icone', 'aria-hidden': 'true' }, icone('i-horloge')),
      el('span', null, `${ev.libelle} ${etat}${quand}` + (ev.raison ? ` · ${ev.raison}` : '')), ev.etat === 'prevu' ? null : moment(d));
    if (ev.annulable && ev.id) {
      const b = el('button', { class: 'lien lien--petit', type: 'button' }, 'Annuler');
      b.addEventListener('click', () => annulerSuivi(ev.id, b));
      ligne.append(b);
    }
    return ligne;
  }
  return el('li', { class: 'evt evt--petit' }, el('span', null, 'Événement'), moment(d));
}

// ─── Répondre ──────────────────────────────────────────────────────────────
function piedDuFil(c) {
  const zone = el('textarea', { id: 'fil-texte', class: 'fil__zone', rows: '2', maxlength: String(MAX_TEXTE), autocomplete: 'off', enterkeyhint: 'send' });
  const compte = el('span', { class: 'fil__compte', 'aria-live': 'polite' });
  const bouton = el('button', { class: 'btn btn--petit', type: 'submit' }, icone('i-envoyer'), 'Envoyer');
  const note = el('p', { class: 'fil__note' });
  const pourquoi = el('p', { class: 'fil__pourquoi', role: 'status' });
  const formulaire = el('form', { class: 'fil__reponse', novalidate: true },
    el('label', { class: 'sr', for: 'fil-texte' }, 'Ton message'), zone, el('div', { class: 'fil__envoi' }, compte, bouton));
  const pied = el('div', { class: 'fil__pied' }, pourquoi, formulaire, note);
  zone.value = A.brouillons.get(cleBrouillon()) || '';
  const majCompte = () => {
    const n = [...zone.value].length;
    compte.textContent = n > MAX_TEXTE - 150 ? `${n} / ${MAX_TEXTE}` : '';
    bouton.disabled = !zone.value.trim() || pied.dataset.ferme === '1';
    zone.style.height = 'auto';
    zone.style.height = Math.min(zone.scrollHeight + 2, 180) + 'px';
  };
  zone.addEventListener('input', () => { A.brouillons.set(cleBrouillon(), zone.value); A.cleEnvoi = ''; majCompte(); });
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); formulaire.requestSubmit(); } });
  formulaire.addEventListener('submit', e => { e.preventDefault(); envoyer(zone, bouton); });
  pied.majCompte = majCompte;
  majPied(pied, c);
  return pied;
}

function majPied(pied, c) {
  const f = A.fil, zone = $('.fil__zone', pied);
  const ferme = f ? !f.peut_texter : false;
  pied.dataset.ferme = ferme ? '1' : '0';
  $('.fil__reponse', pied).hidden = ferme;
  $('.fil__pourquoi', pied).textContent = ferme ? f.pourquoi : '';
  const l = ligneActuelle();
  $('.fil__note', pied).textContent = ferme ? '' : `Part du ${(f && f.de) || (l && l.numero) || 'numéro du commerce'}, signé ${(l && l.nom) || 'du commerce'}${raccourci()}`;
  zone.placeholder = `Écrire à ${nomDe(c)}…`;
  if (pied.majCompte) pied.majCompte();
}

// Le raccourci clavier n'est montré qu'avec un clavier et une souris (pas sur un téléphone)
function raccourci() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return '';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? ' · ⌘ Entrée pour envoyer' : ' · Ctrl + Entrée pour envoyer';
}

async function envoyer(zone, bouton) {
  const texte = zone.value.trim();
  if (!texte || !A.ouvert) return;
  if ([...texte].length > MAX_TEXTE) { toast(`Le message est trop long : ${MAX_TEXTE} caractères au plus.`, true); return; }
  const numero = A.ouvert, ligne = A.ligne;
  A.cleEnvoi = A.cleEnvoi || nouvelleCle('cv');
  const fin = occuper(bouton, 'Envoi…');
  try {
    const r = await api('/portal/admin/conversation/repondre', { methode: 'POST', corps: { ligne, numero, texte, cle: A.cleEnvoi } });
    if (!r.ok) { toast(r.message || 'Pas envoyé.', true); return; }
    A.cleEnvoi = '';
    A.brouillons.delete(`${ligne}|${numero}`);
    if (A.ouvert === numero) zone.value = '';
    toast(r.message || 'Envoyé.');
    const c = convs().find(x => x.numero === numero);
    if (c && r.envoye) Object.assign(c, { a_repondre: false, dernier: r.envoye.quand, apercu: `Vous : ${r.envoye.texte}`.slice(0, 90), de_nous: true, sorte: 'envoye' });
    if (A.vue && c) A.vue.a_repondre = convs().filter(x => x.a_repondre).length;
    if (A.fil && r.envoye && A.ouvert === numero) {
      A.fil.evenements.push(r.envoye);
      A.fil.evenements.sort((a, b) => (date(a.quand) || 0) - (date(b.quand) || 0));     // un suivi prévu reste à la fin
      if (A.fil.conversation) A.fil.conversation.a_repondre = false;
    }
    A.basAvant = true;
    rendreFiltres(); rendreListe(); rendreFil();
  } catch (e) {
    toast(e.message, true);
  } finally {
    fin();
    const pied = $('#appels-fil .fil__pied');
    if (pied && pied.majCompte) pied.majCompte();
    if (A.ouvert === numero && zone.isConnected) zone.focus();
  }
}

async function regler(reglee, bouton) {
  const numero = A.ouvert;
  const fin = occuper(bouton, 'Un instant…');
  try {
    await api('/portal/admin/conversation/reglee', { methode: 'POST', corps: { ligne: A.ligne, numero, reglee } });
    toast(reglee ? 'Réglée : elle sort de « À répondre ».' : 'Elle revient dans « À répondre ».');
    await chargerAppels();
  } catch (e) {
    toast(e.message, true);
    fin();
  }
}

async function annulerSuivi(id, bouton) {
  const fin = occuper(bouton, 'Un instant…');
  try {
    const r = await api('/portal/admin/conversation/annuler', { methode: 'POST', corps: { ligne: A.ligne, id } });
    toast(r.message || 'Texto annulé.', !r.ok);
    await chargerFil({ silencieux: true, frais: true });
  } catch (e) {
    toast(e.message, true);
    fin();
  }
}

// Échap ferme le fil sur un téléphone (et le focus revient sur la conversation)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || E.vue !== 'appels' || !A.ouvert || E.panneau || e.defaultPrevented) return;
  if (!e.target.closest || !e.target.closest('#vue-appels')) return;          // une fenêtre ouverte par-dessus : elle d'abord
  if (e.target.closest('textarea') && e.target.value) return;                // un message en cours : on ne le cache pas
  fermer();
});
