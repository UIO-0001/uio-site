// Argent : ce que les clients paient (abonnements et factures), ce qui est reçu, ce que
// l'agence dépense, le partage 50/50 entre associés, les minutes et le profit de chaque
// client, et les crédits Retell, Twilio et OpenAI.
// Le serveur fait tous les calculs, avec les règles de l'offre ; l'app montre et envoie.
// Chaque ajout porte une clé tirée au hasard : touché deux fois, ou renvoyé après une
// coupure de réseau, il n'est jamais compté deux fois.
import { $, $$, sv, icone, vider, nombre, pluriel, majuscule, premier, date, relatif, heure, ymd, toast, signal } from './outils.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { montrer } from './navigation.js';
import { fermerPanneau } from './panneau.js';
import { prenom, rendreBonjour } from './tableau.js';
import { fr, el, Invalide, nouvelleCle, badge, grand, rangee, confirmations, champTexte, champDate, pilules, liste, bascule,
  formulaireEnLigne, panneauFormulaire as panneauBase } from './formes.js';
import { ouvrirRappel, relireFiches } from './fiche.js';

const ui = { construit: false, charge: null, confirmer: '', solde: '', plusPaiements: false, plusDepenses: false, virements: false };
const LIENS = { retell: 'https://dashboard.retellai.com/', twilio: 'https://console.twilio.com/',
  openai: 'https://platform.openai.com/settings/organization/billing/overview' };
const RECHARGES = {
  retell: { quoi: 'Recharge Retell', devise: 'USD', categorie: 'telephonie', service: 'retell' },
  twilio: { quoi: 'Recharge Twilio', devise: 'USD', categorie: 'telephonie', service: 'twilio' },
  openai: { quoi: 'Recharge OpenAI', devise: 'USD', categorie: 'ia', service: 'openai' }
};

// ─── Montants et dates ─────────────────────────────────────────────────────
// 199 $, 1 299,50 $, −14,43 $ : les cents seulement quand il y en a
export function argent(v, { signe = false, cents = null } = {}) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const d = cents === null ? (Math.round(Math.abs(n) * 100) % 100 ? 2 : 0) : (cents ? 2 : 0);
  const t = `${nombre(Math.abs(n), d)} $`;
  return n < 0 ? `−${t}` : (signe && n > 0 ? `+${t}` : t);
}
const usd = (v, o) => `${argent(v, o)} US`;
const enCents = v => Math.round((Number(v) || 0) * 100);
const somme = (liste, cle) => liste.reduce((s, x) => s + (Number(x[cle]) || 0), 0);
const jourIso = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const aujourdhui = () => (E.argent && E.argent.aujourdhui) || ymd(new Date());
export function leJour(iso, { long = false } = {}) {
  if (!iso) return '';
  const d = jourIso(iso);
  if (isNaN(d)) return '';
  const o = { timeZone: 'UTC', day: 'numeric', month: long ? 'long' : 'short' };
  if (String(iso).slice(0, 4) !== aujourdhui().slice(0, 4)) o.year = 'numeric';
  return premier(d.toLocaleDateString('fr-CA', o));
}
const nomDuMois = (m, long = false) => majuscule(jourIso(`${m}-15`).toLocaleDateString('fr-CA',
  { timeZone: 'UTC', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}) }));
// La règle du serveur : le même jour chaque mois, ou le dernier jour d'un mois plus court
export function ajouterMois(iso, n) {
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number);
  const t = m - 1 + n, an = a + Math.floor(t / 12), mo = ((t % 12) + 12) % 12;
  const dernier = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
  return `${an}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}
const ajouterJours = (iso, n) => { const d = jourIso(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Le journal du serveur écrit « 199.00 $ » et « 2026-11-08 » : à la québécoise ici.
export const detailJoli = t => String(t || '')
  .replace(/(-?\d+)\.(\d{2})(?=\s?(?:\$|USD|CAD))/g, (x, e, c) => argent(Number(`${e}.${c}`)).replace(/ \$$/, ''))
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g, iso => leJour(iso));

// Qui : « Alex », « l’agence »
const nomDe = id => {
  if (!id) return '';
  if (id === 'agence') return 'l’agence';
  const n = E.argent && E.argent.noms && E.argent.noms[id];
  return n ? prenom(n) || n : id;
};
const initiale = id => majuscule(nomDe(id).replace(/^l’/, '')).charAt(0) || '?';
const optionsPersonnes = () => ((E.argent && E.argent.personnes) || [])
  .map(p => [p.identifiant, p.identifiant === 'agence' ? 'L’agence' : prenom(p.nom) || p.identifiant]);

// ─── Lecture et écriture ───────────────────────────────────────────────────
export function chargerArgent({ frais = false, auto = false } = {}) {
  // Jamais par-dessus ce qu'on est en train d'écrire (panneau, solde, confirmation)
  const tape = document.activeElement && document.activeElement.closest && document.activeElement.closest('#vue-argent form');
  if (auto && ((E.panneau && E.panneau.modifie && E.panneau.modifie()) || ui.solde || ui.confirmer || tape)) return Promise.resolve();
  if (ui.charge) return ui.charge;
  const s = sessionActuelle();
  if (E.argent) $$('#vue-argent .carte').forEach(c => c.classList.add('lit'));
  ui.charge = api('/portal/admin/argent' + (frais ? '?frais=1' : ''), { delai: 80000 })
    .then(d => { if (sessionActuelle() === s) { E.argent = d; E.argentErreur = ''; E.argentLu = Date.now(); clesEnAttente.clear(); } })
    .catch(e => { if (e.statut !== 401 && sessionActuelle() === s) E.argentErreur = e.statut === 404 ? 'pas-encore' : e.message; })
    .finally(() => {
      ui.charge = null;
      $$('#vue-argent .lit').forEach(c => c.classList.remove('lit'));
      if (sessionActuelle() !== s || (!E.argent && !E.argentErreur)) return;
      rendreArgent();
      rendreBonjour();
      if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
    });
  return ui.charge;
}

// Chaque changement renvoie tout l'argent recalculé : l'écran suit tout de suite.
async function ecrire(chemin, corps) {
  const s = sessionActuelle();
  const r = await api(`/portal/admin/argent/${chemin}`, { methode: 'POST', corps, delai: 60000 });
  if (sessionActuelle() !== s) return r;
  if (r.argent) { E.argent = r.argent; E.argentErreur = ''; E.argentLu = Date.now(); }
  rendreArgent();
  rendreBonjour();
  if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
  if (/^(abonnement|paiement|ajout)/.test(chemin)) relireFiches();   // les factures de sa fiche suivent
  return r;
}

// Une action confirmée garde sa clé d'un essai à l'autre (réponse perdue, délai dépassé, 2e « Oui ») :
// le serveur ne la note qu'une fois. La clé est oubliée quand l'action a réussi, ou quand l'argent est
// relu du serveur (une action identique plus tard est alors vraiment nouvelle).
const clesEnAttente = new Map();
async function ecrireUneFois(action, prefixe, chemin, corps) {
  if (!clesEnAttente.has(action)) clesEnAttente.set(action, nouvelleCle(prefixe));
  const r = await ecrire(chemin, { ...corps, cle: clesEnAttente.get(action) });
  clesEnAttente.delete(action);
  return r;
}

export function viderArgent() {
  E.argent = null; E.argentErreur = ''; E.argentLu = 0;
  clesEnAttente.clear();
  Object.assign(ui, { confirmer: '', solde: '', plusPaiements: false, plusDepenses: false, virements: false });
  if (ui.construit) rendreArgent();
}

// ─── Petits morceaux d'écran ───────────────────────────────────────────────
function attente(boite) {
  if (E.argent) return false;
  vider(boite, el('p', { class: 'vide' }, E.argentErreur === 'pas-encore'
    ? 'L’argent s’affichera ici dès que le serveur aura reçu sa mise à jour.' : E.argentErreur || 'Lecture en cours…'));
  return true;
}

const ETATS_FACTURE = { payee: ['Payée', ''], credit: ['Couverte par le crédit', ''], remboursee: ['Remboursée', 'neutre'],
  a_venir: ['À venir', 'neutre'], due: ['Due', 'attente'], en_retard: ['En retard', 'alerte'] };
export function badgeFacture(f) {
  let [texte, genre] = ETATS_FACTURE[f.etat] || [f.etat, 'neutre'];
  if (f.etat === 'a_venir') texte = f.jours === 1 ? 'Demain' : `Dans ${f.jours} j`;
  if (f.etat === 'due') texte = f.jours === 0 ? 'Due aujourd’hui' : `Due depuis ${-f.jours} j`;
  if (f.etat === 'en_retard') texte = `En retard de ${-f.jours} j`;
  return badge(texte, genre);
}

// Confirmer sur place (aucune fenêtre du navigateur) : « Annuler ce paiement ? Non · Oui »
const confirmer = confirmations(ui, rendreArgent);

// Le client d'un abonnement (son espace client), pour lui préparer un rappel de paiement
function clientDe(abId) {
  const ab = E.argent && E.argent.abonnements.find(x => x.id === abId);
  return ab && ab.client && (E.clients || []).some(c => String(c.client_id) === String(ab.client)) ? String(ab.client) : '';
}
const aRelancer = f => (f.etat === 'due' || f.etat === 'en_retard') && f.reste > 0;
const boutonRappel = (abId, f, texte = 'Rappel') => {
  const client = aRelancer(f) ? clientDe(abId) : '';
  return client ? el('button', { class: 'btn btn--discret btn--petit', type: 'button', title: 'Préparer un rappel de paiement pour ce client',
    onclick: () => ouvrirRappel(client, abId, f.numero) }, icone('i-courriel'), texte) : null;
};

// ─── La page ───────────────────────────────────────────────────────────────
function construire() {
  if (ui.construit) return;
  ui.construit = true;
  const carte = (classe, id, titre, ...tete) => el('article', { class: `carte ${classe}`, id: `carte-${id}`, 'aria-labelledby': `t-${id}` },
    el('div', { class: 'carte__tete' }, el('h2', { id: `t-${id}` }, titre), ...tete),
    el('div', { class: 'carte__corps', id: `argent-${id}` }));
  const lien = (texte, onclick) => el('button', { class: 'lien', type: 'button', onclick }, texte);
  vider($('#vue-argent'),
    el('div', { class: 'argent__tete' },
      el('div', { class: 'argent__titre' }, el('h1', null, 'Argent'), el('p', { id: 'argent-phrase' }, 'Lecture des comptes…')),
      el('div', { class: 'argent__actions' },
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirDepense() }, icone('i-plus'), 'Dépense'))),
    el('div', { class: 'grille' },
      carte('carte--mois l7', 'mois', 'Revenus et dépenses'),
      carte('carte--encaisser l5', 'encaisser', 'À encaisser'),
      carte('carte--abonnements pleine-largeur', 'abonnements', 'Abonnements', lien('Ajouter', () => ouvrirAbonnement())),
      carte('carte--minutes l7', 'minutes', 'Minutes et profit', el('a', { class: 'lien', href: LIENS.retell, target: '_blank', rel: 'noopener' }, 'Retell')),
      carte('carte--credits l5', 'credits', 'Crédits'),
      carte('carte--depenses l7', 'depenses', 'Dépenses'),
      carte('carte--partage l5', 'partage', 'Partage 50/50', lien('Virement', () => ouvrirVirement())),
      carte('carte--paiements pleine-largeur', 'paiements', 'Paiements reçus', lien('Autre revenu', () => ouvrirPaiement({ autre: true })))));
}

export function rendreArgent() {
  if (!$('#vue-argent')) return;                 // une page d'une version plus ancienne (mise à jour en cours)
  construire();
  rendreTete(); rendreMois(); rendreEncaisser(); rendreAbonnements(); rendreMinutes();
  rendreCredits(); rendreDepenses(); rendrePartage(); rendrePaiements();
}

function rendreTete() {
  const p = $('#argent-phrase');
  if (!p) return;
  const a = E.argent;
  if (!a) {
    p.textContent = fr(E.argentErreur === 'pas-encore' ? 'Bientôt : le serveur doit d’abord recevoir sa mise à jour.' : (E.argentErreur || 'Lecture des comptes…'));
    return;
  }
  const r = a.resume, b = t => el('b', null, t);
  const morceaux = [b(`${argent(r.mrr)} par mois`), ` de ${pluriel(r.clients_actifs, 'client actif', 'clients actifs')}`];
  if (r.a_encaisser > 0) morceaux.push(', ', b(argent(r.a_encaisser)), ' à encaisser');
  if (r.en_retard) morceaux.push(', dont ', el('b', { class: 'attention' }, pluriel(r.en_retard, 'facture en retard', 'factures en retard')));
  morceaux.push('.');
  const g = date(a.genere_a);
  vider(p, morceaux, el('span', { class: 'argent__maj' },
    [g ? `Lu à ${heure(g)}` : '', a.taux_usd_cad ? `1 $ US = ${nombre(a.taux_usd_cad, 2)} $` : ''].filter(Boolean).join(' · ')));
}

// ─── Revenus et dépenses : 12 mois ─────────────────────────────────────────
function rendreMois() {
  const boite = $('#argent-mois');
  if (!boite || attente(boite)) return;
  const a = E.argent, r = a.resume, m = r.mois;
  vider(boite,
    grand(argent(r.mrr), 'par mois',
      r.clients_actifs ? `Les abonnements de ${pluriel(r.clients_actifs, 'client actif', 'clients actifs')}. ` : 'Aucun client actif pour l’instant. ',
      'Ce mois-ci : ', [argent(m.prevu)], ' prévus, ', [argent(m.recu)], ' reçus et ', [argent(m.depenses)], ' de dépenses.'),
    graphiqueMois(a.mois),
    el('ul', { class: 'legende' },
      el('li', { class: 'legende__entrees' }, 'Reçu'),
      el('li', { class: 'legende__sorties' }, 'Dépenses'),
      el('li', { class: 'legende__prevu' }, 'Prévu (contour)')));
}

// Une échelle ronde et serrée : 600, 1 200, 1 500, 2 000, 2 500…
function echelle(max) {
  const p = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max) return f * p;
  return 10 * p;
}
// Une colonne au bout arrondi, posée sur la ligne du bas
function colonne(x, w, haut, base, classe) {
  const h = Math.max(1.5, base - haut), y0 = base - h, r = Math.min(4, h, w / 2);
  return sv('path', { class: classe, d: `M${x},${base} L${x},${y0 + r} Q${x},${y0} ${x + r},${y0} L${x + w - r},${y0} Q${x + w},${y0} ${x + w},${y0 + r} L${x + w},${base} Z` });
}

let observateurMois = null, cacherBulleMois = null;
document.addEventListener('pointerdown', e => { if (cacherBulleMois && !e.target.closest('.graphe--mois')) cacherBulleMois(); }, { passive: true });

function graphiqueMois(mois) {
  const boite = el('div', { class: 'graphe graphe--mois' });
  const entree = m => (m.futur ? m.prevu : m.recu);
  const passes = mois.filter(m => !m.futur), futurs = mois.filter(m => m.futur);
  const resume = `Revenus et dépenses sur ${mois.length} mois : ${argent(somme(passes, 'recu'))} reçus et ${argent(somme(passes, 'depenses'))} de dépenses jusqu’à ce mois-ci, ${argent(somme(futurs, 'prevu'))} prévus les mois suivants.`;
  // La table est dans une boîte .sr : seule, elle garde sa largeur et élargirait la page sur un petit écran
  const tableau = el('div', { class: 'sr' }, el('table', null, el('caption', null, 'Revenus et dépenses par mois'),
    el('tr', null, ['Mois', 'Prévu', 'Reçu', 'Dépenses'].map(t => el('th', null, t))),
    mois.map(m => el('tr', null, el('td', null, nomDuMois(m.mois, true)), el('td', null, argent(m.prevu)),
      el('td', null, m.futur ? 'à venir' : argent(m.recu)), el('td', null, argent(m.depenses))))));
  let dessinee = -1;
  const dessiner = () => {
    const largeur = boite.clientWidth;
    if (largeur === dessinee) return;
    dessinee = largeur;
    const W = Math.max(280, largeur || 560), H = W >= 520 ? 240 : 180, haut = 18, bas = 24;
    const plafond = echelle(Math.max(1, ...mois.map(m => Math.max(m.prevu, m.recu, m.depenses))));
    const y = v => H - bas - (H - haut - bas) * Math.max(0, v) / plafond;
    const n = mois.length, pas = W / n, groupe = Math.max(8, Math.min(40, pas - 6)), b = (groupe - 2) / 2;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': resume });
    [0.5, 1].forEach(f => {
      const yy = Math.round(y(plafond * f)) + 0.5;
      svg.append(sv('line', { class: 'grille-l grille-l--douce', x1: 0, x2: W, y1: yy, y2: yy }),
        sv('text', { class: 'axe', x: 0, y: yy - 5 }, argent(plafond * f)));
    });
    svg.append(sv('line', { class: 'grille-l', x1: 0, x2: W, y1: H - bas + 0.5, y2: H - bas + 0.5 }));
    const bulle = el('div', { class: 'infobulle', hidden: true });
    const saut = pas >= 34 ? 1 : 2;
    const groupes = mois.map((m, i) => {
      const g = sv('g', { class: `mois__groupe${m.actuel ? ' actuel' : ''}` });
      const x0 = pas * i + (pas - groupe) / 2;
      // Ce mois-ci, le contour montre ce qui reste à recevoir ; les mois à venir sont en contour
      if (m.actuel && m.prevu > m.recu) g.append(colonne(x0, b, y(m.prevu), H - bas, 'mois__barre mois__barre--entrees prevu'));
      if (entree(m) > 0) g.append(colonne(x0, b, y(entree(m)), H - bas, `mois__barre mois__barre--entrees${m.futur ? ' prevu' : ''}`));
      if (m.depenses > 0) g.append(colonne(x0 + b + 2, b, y(m.depenses), H - bas, `mois__barre mois__barre--sorties${m.futur ? ' prevu' : ''}`));
      if (i % saut === 0 || m.actuel) g.append(sv('text', { class: `axe${m.actuel ? ' axe--actuel' : ''}`, x: pas * i + pas / 2, y: H - 7, 'text-anchor': 'middle' }, nomDuMois(m.mois)));
      const zone = sv('rect', { class: 'mois__zone', x: pas * i, y: 0, width: pas, height: H - bas, fill: 'transparent' });
      zone.addEventListener('pointerenter', () => montrerBulle(i));
      zone.addEventListener('pointerdown', () => montrerBulle(i));
      g.append(zone);
      svg.append(g);
      return g;
    });
    function montrerBulle(i) {
      const m = mois[i];
      groupes.forEach((g, j) => g.classList.toggle('actif', j === i));
      svg.classList.add('survol');
      const lignes = m.futur
        ? [`Prévu : ${argent(m.prevu)}`, `Dépenses prévues : ${argent(m.depenses)}`]
        : [`Reçu : ${argent(m.recu)}${m.prevu ? ` sur ${argent(m.prevu)} prévus` : ''}`, `Dépenses : ${argent(m.depenses)}`, `Net : ${argent(m.recu - m.depenses, { signe: true })}`];
      vider(bulle, el('b', null, nomDuMois(m.mois, true)), lignes.map(t => el('span', { class: 'infobulle__ligne' }, t)));
      bulle.hidden = false;
      const rb = svg.getBoundingClientRect(), k = rb.width / W, demi = bulle.offsetWidth / 2;
      bulle.style.left = `${Math.max(demi, Math.min(rb.width - demi, (pas * i + pas / 2) * k))}px`;
      bulle.style.top = `${(Math.min(y(Math.max(m.prevu, m.recu, m.depenses)), H - bas) / H) * rb.height}px`;
    }
    const cacher = () => { bulle.hidden = true; svg.classList.remove('survol'); groupes.forEach(g => g.classList.remove('actif')); };
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cacher(); });
    cacherBulleMois = cacher;
    vider(boite, svg, bulle, tableau);
  };
  if (observateurMois) observateurMois.disconnect();
  observateurMois = new ResizeObserver(() => dessiner());
  observateurMois.observe(boite);
  return boite;
}

// ─── À encaisser ───────────────────────────────────────────────────────────
function rendreEncaisser() {
  const boite = $('#argent-encaisser');
  if (!boite || attente(boite)) return;
  const a = E.argent, r = a.resume;
  const dues = a.echeances.filter(f => f.etat === 'due' || f.etat === 'en_retard');
  signal('carte-encaisser', r.en_retard ? 'alerte' : dues.length ? 'attente' : '');
  const blocs = [];
  if (r.a_encaisser > 0) {
    const phrase = [pluriel(dues.length, 'facture due', 'factures dues')];
    if (r.en_retard) phrase.push(', dont ', [`${r.en_retard} en retard`], ' (plus de 7 jours)');
    phrase.push('.');
    blocs.push(grand(argent(r.a_encaisser), 'à encaisser', ...phrase));
  } else {
    const prochaine = a.abonnements.flatMap(ab => ab.factures.filter(f => f.etat === 'a_venir' && f.du > 0).map(f => ({ ...f, nom: ab.nom })))
      .sort((x, z) => x.echeance.localeCompare(z.echeance))[0];
    const phrase = ['Rien de dû ni en retard.'];
    if (prochaine) phrase.push(' Prochaine facture : ', [prochaine.nom], `, ${argent(prochaine.du)} le ${leJour(prochaine.echeance)}.`);
    blocs.push(grand('0 $', 'à encaisser', ...phrase));
  }
  const liste = a.echeances.filter(f => f.reste > 0);
  if (liste.length) blocs.push(el('ul', { class: 'liste', 'aria-label': 'Factures à encaisser' }, liste.map(f => el('li', null,
    el('div', { class: 'ligne' }, el('span', { class: 'ligne__titre' }, f.nom), badgeFacture(f), el('span', { class: 'montant' }, argent(f.reste))),
    el('div', { class: 'ligne' },
      el('span', { class: 'ligne__meta' }, [`Facture ${f.numero} du ${leJour(f.echeance)}`, f.paye > 0 ? `${argent(f.paye)} déjà reçus` : '',
        f.depart ? 'frais de départ compris' : '', f.credit ? `${argent(f.credit)} crédités` : ''].filter(Boolean).join(' · ')),
      el('span', { class: 'ligne__boutons ml-auto' }, boutonRappel(f.abonnement, f),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirPaiement({ abonnement: f.abonnement, facture: f.numero }) }, 'Marquer payée')))))));
  vider(boite, blocs);
}

// ─── Abonnements ───────────────────────────────────────────────────────────
function rendreAbonnements() {
  const boite = $('#argent-abonnements');
  if (!boite || attente(boite)) return;
  const liste = E.argent.abonnements;
  signal('carte-abonnements', liste.some(ab => ab.probleme) ? 'alerte' : '');
  if (!liste.length) {
    return vider(boite, el('p', { class: 'vide' }, 'Aucun abonnement pour l’instant. Ses factures, le crédit des frais et la garantie se calculent tout seuls.'));
  }
  vider(boite, el('div', { class: 'abonnements' }, liste.map(carteAbonnement)));
}

function carteAbonnement(ab) {
  const auj = aujourdhui();
  const prochaine = ab.factures.find(f => f.numero === ab.prochaine);
  const dues = ab.factures.filter(f => (f.etat === 'due' || f.etat === 'en_retard') && f.reste > 0);
  const badges = [];
  if (ab.etat === 'termine') badges.push(ab.fin > auj ? badge(`Se termine le ${leJour(ab.fin)}`, 'attente') : badge('Terminé', 'neutre'));
  if (ab.etat === 'rembourse') badges.push(badge('Remboursé', 'neutre'));
  if (dues.some(f => f.etat === 'en_retard')) badges.push(badge('Facture en retard', 'alerte'));
  else if (dues.length) badges.push(badge('Facture due', 'attente'));
  if (ab.probleme) badges.push(badge('À vérifier', 'alerte'));
  const suite = [];
  const encours = ab.etat === 'actif' || (ab.etat === 'termine' && ab.fin > auj);
  // « n° 4, 0 $ » se lirait « 4,0 $ » : le numéro, la date, puis le montant
  if (encours && prochaine) suite.push(`Prochaine facture : n° ${prochaine.numero} le ${leJour(prochaine.echeance)}, `, el('b', null, argent(prochaine.du)));
  if (encours && ab.credit.restant > 0) {
    suite.push(suite.length ? ' · ' : '', ab.credit.utilise > 0 ? `${argent(ab.credit.restant)} de crédit restant`
      : prochaine && ab.credit.des === prochaine.echeance ? `${argent(ab.credit.total)} de frais crédités à partir de celle-ci`
        : `${argent(ab.credit.total)} crédités dès le ${leJour(ab.credit.des)}`);
  }
  if (encours && ab.garantie.possible) suite.push(' · garantie jusqu’au ', leJour(ab.garantie.jusqua));
  if (!encours && ab.fin) suite.push(`Plus de facture depuis le ${leJour(ab.fin)}`);
  return el('button', { class: `abonnement${encours ? '' : ' abonnement--fini'}`, type: 'button', 'data-focus': `ab-${ab.id}`, onclick: () => ouvrirAbonnement(ab.id) },
    el('span', { class: 'abonnement__haut' }, el('span', { class: 'abonnement__nom' }, ab.nom || 'Client'),
      el('span', { class: 'abonnement__prix' }, argent(ab.total_mensuel), el('small', null, ' par mois'))),
    el('span', { class: 'abonnement__meta' },
      el('span', null, [ab.forfait_nom, ab.minutes_incluses ? `${nombre(ab.minutes_incluses)} min` : '', ab.debut ? `depuis le ${leJour(ab.debut)}` : ''].filter(Boolean).join(' · ')),
      badges),
    suite.length ? el('span', { class: 'abonnement__suite' }, suite) : null);
}

// ─── Minutes et profit ─────────────────────────────────────────────────────
function rendreMinutes() {
  const boite = $('#argent-minutes');
  if (!boite || attente(boite)) return;
  const m = E.argent.minutes || {};
  const cl = m.disponible ? m.clients || [] : [];
  signal('carte-minutes', cl.some(c => c.pourcentage >= 100) ? 'alerte' : cl.some(c => c.alerte) ? 'attente' : '');
  if (!m.disponible) {
    return vider(boite, el('p', { class: 'vide' }, `Appels de Retell indisponibles pour le moment (${m.raison || 'raison inconnue'}).`));
  }
  const blocs = [];
  if (m.clients.length) {
    const revenu = somme(m.clients, 'revenu'), profit = somme(m.clients, 'profit'), minutes = somme(m.clients, 'minutes');
    blocs.push(grand(argent(profit), 'de profit',
      'Ce cycle-ci, sur ', [argent(revenu)], ' de revenus', revenu > 0 ? ` (marge de ${Math.round(profit / revenu * 100)} %)` : '',
      ', pour ', [`${nombre(minutes, minutes % 1 ? 1 : 0)} min`], ' d’appels.'));
    blocs.push(el('div', { class: 'minutes' }, m.clients.map(ligneMinutes)));
  } else {
    blocs.push(el('p', { class: 'vide' }, 'Relie l’agent Retell d’un client à son abonnement : ses minutes et son profit s’afficheront ici.'));
  }
  if (m.autres && m.autres.length) {
    blocs.push(el('div', { class: 'bloc' }, el('h3', { class: 'petit-titre' }, 'Autres agents ce mois-ci (agence, démos)'),
      el('ul', { class: 'liste' }, m.autres.map(x => el('li', null, el('div', { class: 'ligne' },
        el('span', { class: 'ligne__titre' }, x.nom),
        el('span', { class: 'ligne__meta' }, `${pluriel(x.appels, 'appel', 'appels')} · ${nombre(x.minutes, x.minutes % 1 ? 1 : 0)} min`),
        el('span', { class: 'montant' }, argent(x.cout))))))));
  }
  blocs.push(el('p', { class: 'note' }, `En $ CA : Retell réel, Twilio estimé (${nombre(m.twilio_estime_us_minute, 3)} $ US la minute). Pourriels, essais web et appels de moins de 15 s non comptés.`));
  if (m.complet === false) blocs.push(el('p', { class: 'note' }, 'Plus de 1 000 appels : seuls les 1 000 plus récents sont comptés.'));
  vider(boite, blocs);
}

function ligneMinutes(c) {
  const pct = c.pourcentage;
  const genre = pct == null ? 'bleu' : pct >= 100 ? 'rouge' : (c.alerte ? '' : 'bleu');
  const ab = E.argent.abonnements.find(x => x.id === c.abonnement);
  const min = v => `${nombre(v, v % 1 ? 1 : 0)}`;
  return el('div', { class: 'minute' },
    el('div', { class: 'ligne' },
      el('span', { class: 'ligne__titre' }, c.nom || 'Client'),
      c.alerte ? badge(pct >= 100 ? 'Forfait dépassé' : `${pct} % du forfait`, pct >= 100 ? 'alerte' : 'attente') : null,
      el('span', { class: 'montant' }, c.incluses ? `${min(c.minutes)} / ${nombre(c.incluses)} min` : `${min(c.minutes)} min`)),
    c.incluses ? el('span', { class: `jauge jauge--epaisse${genre ? ` jauge--${genre}` : ''}`, role: 'img', 'aria-label': `${pct} % des minutes du forfait` },
      el('i', { style: `width:${Math.min(100, Math.max(0, pct))}%` })) : null,
    el('p', { class: 'ligne__meta' }, [pluriel(c.appels, 'appel compté', 'appels comptés'), c.non_comptes ? `${c.non_comptes} non comptés` : '',
      `cycle du ${leJour(c.cycle_debut)} au ${leJour(c.cycle_fin)}`,
      c.projection != null && c.incluses ? `à ce rythme : environ ${nombre(c.projection)} min` : ''].filter(Boolean).join(' · ')),
    el('dl', { class: 'chiffres' },
      el('div', null, el('dt', null, 'Coût'), el('dd', null, argent(c.cout))),
      el('div', null, el('dt', null, 'Revenu'), el('dd', null, argent(c.revenu))),
      el('div', null, el('dt', null, 'Profit'), el('dd', null, argent(c.profit), c.marge != null ? el('small', null, `marge ${c.marge} %`) : null))),
    c.minutes_en_plus > 0 ? blocEnPlus(c, ab) : null);
}

// Les minutes au-delà du forfait : à ajouter à la prochaine facture (0,39 $ la minute)
function blocEnPlus(c, ab) {
  const n = c.facture_suivante;
  const f = ab && ab.factures.find(x => x.numero === n);
  const deja = f && f.ajouts.find(x => /^minutes en plus/i.test(x.quoi));
  const quoi = `Minutes en plus : ${c.minutes_en_plus} min (cycle du ${leJour(c.cycle_debut)} au ${leJour(c.cycle_fin)})`;
  const ajouter = () => ecrireUneFois(`plus:${c.abonnement}:${n}:${c.a_facturer}`, 'aj', 'ajout',
    { abonnement: c.abonnement, facture: n, montant: c.a_facturer, quoi });
  let action = null;
  if (f && deja && Math.abs(deja.montant - c.a_facturer) < 0.005) action = el('span', { class: 'note' }, `Déjà sur la facture ${f.numero}.`);
  else if (f && deja) {
    action = confirmer(`plus:${c.abonnement}:${f.numero}`, `Mettre à jour la facture ${f.numero}`, `Remplacer ${argent(deja.montant)} par ${argent(c.a_facturer)} ?`, async () => {
      await ecrire('ajout', { abonnement: c.abonnement, id: deja.id, retirer: true });
      await ajouter();
      toast(`Facture ${f.numero} mise à jour.`);
    }, { danger: false });
  } else if (f) {
    action = confirmer(`plus:${c.abonnement}:${f.numero}`, `Ajouter à la facture ${f.numero}`, `Ajouter ${argent(c.a_facturer)} à la facture ${f.numero} ?`,
      async () => { await ajouter(); toast(`Ajouté à la facture ${f.numero}.`); }, { danger: false });
  } else if (ab && ab.fin) {
    // Le dernier cycle d'un abonnement qui se termine : une facture de plus, avec ces minutes seulement
    action = confirmer(`plus:${c.abonnement}:${n}`, `Facturer après la fin (n° ${n})`, `Facturer ${argent(c.a_facturer)} sur une dernière facture, sans mois ?`,
      async () => { await ajouter(); toast(`Facture ${n} créée avec les minutes en plus.`); }, { danger: false });
  }
  return el('div', { class: 'info info--action' },
    el('span', null, `${pluriel(c.minutes_en_plus, 'minute', 'minutes')} en plus : `, el('b', null, `${argent(c.a_facturer)} à facturer`),
      ` (${argent(E.argent.regles.minute_en_plus)} la minute).`), action);
}

// ─── Crédits ───────────────────────────────────────────────────────────────
function rendreCredits() {
  const boite = $('#argent-credits');
  if (!boite || attente(boite)) return;
  const c = E.argent.credits, s = c.seuils || {};
  const rt = c.retell || {}, tw = c.twilio || {}, oa = c.openai || {};
  const lignes = [];
  const twilioVide = tw.alerte && tw.solde_usd != null && Number(tw.solde_usd) <= 0;
  signal('carte-credits', rt.etat === 'epuise' || twilioVide || oa.etat === 'epuise' || oa.etat === 'cle_refusee' ? 'alerte'
    : rt.alerte || tw.alerte ? 'attente' : '');

  const bR = [], mR = [];
  if (rt.etat === 'estime') {
    if (rt.alerte) bR.push(badge('Bas', 'alerte'));
    mR.push(el('b', { class: 'credit__chiffre' }, `Environ ${usd(rt.estime_usd, { cents: true })}`));
    mR.push([`environ ${nombre(rt.minutes_restantes)} min d’appels`, rt.jours_restants != null ? `${pluriel(rt.jours_restants, 'jour', 'jours')} au rythme des 2 dernières semaines` : ''].filter(Boolean).join(' · '));
    const recharges = rt.estime_usd - rt.note.montant_usd + rt.depense_usd;
    mR.push(`D’après le solde noté ${relatif(date(rt.note.quand) || new Date())} (${usd(rt.note.montant_usd, { cents: true })})${rt.depense_usd > 0.004 ? `, moins ${usd(rt.depense_usd, { cents: true })} d’appels depuis` : ''}${recharges > 0.004 ? `, plus ${usd(recharges, { cents: true })} de recharges` : ''}.`);
  } else if (rt.etat === 'epuise') {
    bR.push(badge('Épuisé', 'alerte'));
    mR.push('Les appels ne passent plus. Recharge le crédit dans Retell, puis note le nouveau solde ici.');
  } else if (rt.etat === 'trop_vieux') {
    mR.push('Le dernier solde noté date de plus de 3 mois. Note le solde affiché dans Retell.');
  } else {
    mR.push(rt.note && rt.raison ? `Estimation indisponible (${rt.raison}).` : 'Note le solde affiché dans Retell : le CRM suit ensuite ce qui reste, appel par appel.');
  }
  lignes.push(rangee({ lettre: 'R', titre: lienService('retell'), badges: bR, meta: mR, action: actionsCredit('retell') }));
  if (ui.solde === 'retell') lignes.push(formulaireSolde('retell'));

  const bT = [], mT = [];
  if (tw.disponible) {
    mT.push(el('b', { class: 'credit__chiffre' }, usd(tw.solde_usd, { cents: true })));
    if (tw.alerte) { bT.push(badge('Bas', 'alerte')); mT.push(`Moins de ${usd(s.twilio_usd)} : recharge bientôt, sinon les appels et les textos s’arrêtent.`); }
    else mT.push('Le solde réel, lu chez Twilio.');
  } else mT.push(`Indisponible pour le moment (${tw.raison || 'raison inconnue'}).`);
  lignes.push(rangee({ lettre: 'T', titre: lienService('twilio'), badges: bT, meta: mT, action: actionsCredit('twilio') }));

  const bO = [], mO = [];
  if (oa.disponible && oa.etat === 'ok') mO.push('Le crédit répond : le chatbot marche.');
  else if (oa.etat === 'epuise') { bO.push(badge('Épuisé', 'alerte')); mO.push('Le chatbot ne répond plus. Recharge le crédit OpenAI.'); }
  else if (oa.etat === 'cle_refusee') { bO.push(badge('Clé refusée', 'alerte')); mO.push('OpenAI refuse la clé du serveur : il faut la remplacer dans Render.'); }
  else mO.push(`Indisponible pour le moment (${oa.raison || 'raison inconnue'}).`);
  if (oa.note) mO.push(`Solde noté ${relatif(date(oa.note.quand) || new Date())} : ${usd(oa.note.montant_usd, { cents: true })}.`);
  lignes.push(rangee({ lettre: 'O', titre: lienService('openai'), badges: bO, meta: mO, action: actionsCredit('openai') }));
  if (ui.solde === 'openai') lignes.push(formulaireSolde('openai'));

  vider(boite, el('div', { class: 'rangees' }, lignes),
    el('p', { class: 'note' }, `Retell : estimé d’après le dernier solde noté (alerte sous ${usd(s.retell_usd)}). Twilio : le solde réel. OpenAI : vérifié toutes les 30 min.`));
}

// Le nom du service ouvre son tableau de bord (nouvel onglet)
function lienService(service) {
  const nom = E.argent.regles.services[service];
  return el('a', { class: 'lien-service', href: LIENS[service], target: '_blank', rel: 'noopener', title: `Ouvrir ${nom}` }, nom, icone('i-sortie'));
}

function actionsCredit(service) {
  return [
    service !== 'twilio' ? el('button', { class: 'btn btn--contour btn--petit', type: 'button', 'aria-expanded': String(ui.solde === service), onclick: () => {
      ui.solde = ui.solde === service ? '' : service;
      rendreCredits();
      const champ = $(`#solde-${service} input`);
      if (champ) champ.focus();
    } }, 'Noter le solde') : null,
    el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirDepense('', RECHARGES[service]) }, 'J’ai rechargé')];
}

function formulaireSolde(service) {
  const nom = E.argent.regles.services[service];
  const m = champMontant(`Solde affiché dans ${nom}`, '', { devise: '$ US' });
  const note = champTexte('Note', { maxlength: 200, autocomplete: 'off', placeholder: 'Ex. : après la recharge du matin' }, '', 'facultatif');
  const cle = nouvelleCle('so');
  const form = formulaireEnLigne({ elements: [m.boite, note.boite], bouton: 'Enregistrer',
    annuler: () => { ui.solde = ''; rendreCredits(); },
    envoyer: async () => {
      const v = m.lire();
      if (v == null || Number.isNaN(v)) throw new Invalide('Écris le solde, par exemple 18,40.', m.input);
      ui.solde = '';
      try { await ecrire('solde', { service, montant_usd: v, note: note.input.value.trim(), cle }); }
      catch (e) { ui.solde = service; throw e; }
      toast(`Solde ${nom} noté.`);
    } });
  form.id = `solde-${service}`;
  return form;
}

// ─── Dépenses ──────────────────────────────────────────────────────────────
function rendreDepenses() {
  const boite = $('#argent-depenses');
  if (!boite || attente(boite)) return;
  const a = E.argent, liste = a.depenses;
  if (!liste.length) {
    return vider(boite, el('p', { class: 'vide' }, 'Aucune dépense pour l’instant. Note ce que l’agence paie et qui l’a payé : le partage 50/50 suit.'));
  }
  const revient = liste.filter(d => d.active && d.frequence !== 'unique');
  const parMois = revient.reduce((s, d) => s + (d.frequence === 'mensuel' ? d.cad : d.cad / 12), 0);
  const parPayeur = {};
  liste.forEach(d => { if (d.total > 0) parPayeur[d.payeur] = (parPayeur[d.payeur] || 0) + d.total; });
  const qui = Object.entries(parPayeur).map(([p, v]) => `${argent(v)} par ${nomDe(p)}`);
  const phrase = [revient.length ? `${pluriel(revient.length, 'dépense revient', 'dépenses reviennent')} chaque mois ou chaque année. ` : 'Aucune dépense qui revient. ',
    'Depuis le début : ', [argent(a.resume.total.depenses)], ' payés', qui.length > 1 ? ` (${qui.join(', ')})` : '', '.'];
  const montrees = ui.plusDepenses ? liste : liste.slice(0, 8);
  // Ce qui part bientôt : les paiements des 14 prochains jours, pour garder l'argent prêt
  const bientot = a.prochaines_depenses.length ? el('div', { class: 'bloc' }, el('h3', { class: 'petit-titre' }, 'Dans les 14 prochains jours'),
    el('ul', { class: 'liste' }, a.prochaines_depenses.map(d => el('li', null, el('div', { class: 'ligne' },
      el('span', { class: 'ligne__titre' }, d.quoi),
      el('span', { class: 'ligne__meta' }, [`le ${leJour(d.date)}`, d.payeur ? `payé par ${nomDe(d.payeur)}` : ''].filter(Boolean).join(' · ')),
      el('span', { class: 'montant' }, d.devise === 'USD' ? usd(d.montant) : argent(d.cad))))))) : null;
  const tout = el('ul', { class: 'liste', 'aria-label': 'Toutes les dépenses' }, montrees.map(ligneDepense));
  vider(boite,
    grand(argent(parMois), 'par mois', ...phrase),
    bientot,
    bientot ? el('div', { class: 'bloc' }, el('h3', { class: 'petit-titre' }, 'Toutes les dépenses'), tout) : tout,
    liste.length > montrees.length ? el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => { ui.plusDepenses = true; rendreDepenses(); } }, `Voir les ${liste.length - montrees.length} autres`) : null);
}

function ligneDepense(d) {
  const R = E.argent.regles, auj = aujourdhui();
  const quand = d.frequence === 'unique' ? `le ${leJour(d.debut)}` : (d.debut > auj ? `à partir du ${leJour(d.debut)}` : `depuis le ${leJour(d.debut)}`);
  const fin = d.fin ? (d.active ? `s’arrête le ${leJour(d.fin)}` : `arrêtée le ${leJour(d.fin)}`) : '';
  return el('li', null, el('button', { class: 'depense', type: 'button', 'data-focus': `de-${d.id}`, onclick: () => ouvrirDepense(d.id) },
    el('span', { class: 'ligne' },
      el('span', { class: 'ligne__titre' }, d.quoi),
      d.frequence !== 'unique' ? badge(R.frequences[d.frequence], 'neutre') : null,
      !d.active ? badge('Arrêtée', 'neutre') : null,
      el('span', { class: 'montant' }, argent(d.cad), d.devise === 'USD' ? el('small', null, ` ${usd(d.montant)}`) : null)),
    el('span', { class: 'ligne__meta' }, [R.categories[d.categorie], d.payeur ? `payé par ${nomDe(d.payeur)}` : '', quand, fin,
      d.fois > 1 ? `${d.fois} fois, ${argent(d.total)} en tout` : ''].filter(Boolean).join(' · '))));
}

// ─── Partage 50/50 ─────────────────────────────────────────────────────────
function rendrePartage() {
  const boite = $('#argent-partage');
  if (!boite || attente(boite)) return;
  const a = E.argent, p = a.partage || {}, gens = p.personnes || [];
  const sugg = p.suggestions || [];
  signal('carte-partage', gens.length >= 2 && sugg.length ? 'attente' : '');
  if (gens.length < 2) return vider(boite, el('p', { class: 'vide' }, 'Le partage s’affiche dès que deux associés ont leur compte.'));
  const blocs = [];
  if (sugg.length) {
    blocs.push(grand(argent(somme(sugg, 'montant')), 'à envoyer', 'Pour que chacun ait sa moitié de ce qui est entré et sorti.'));
    blocs.push(el('div', { class: 'rangees' }, sugg.map(s => rangee({ lettre: initiale(s.de), titre: `${majuscule(nomDe(s.de))} envoie ${argent(s.montant)} à ${nomDe(s.a)}`,
      meta: ['Par virement Interac, puis « C’est fait ».'],
      action: confirmer(`vir:${s.de}:${s.a}:${s.montant}`, 'C’est fait', `${majuscule(nomDe(s.de))} a envoyé ${argent(s.montant)} ?`, async () => {
        await ecrireUneFois(`vir:${s.de}:${s.a}:${s.montant}`, 'vi', 'virement', { de: s.de, a: s.a, montant: s.montant, date: aujourdhui(), note: 'Partage 50/50' });
        toast('Virement noté.');
      }, { danger: false }) }))));
  } else blocs.push(grand('0 $', 'à envoyer', 'Vous êtes à parts égales : rien à équilibrer.'));
  blocs.push(el('div', { class: 'rangees' }, gens.map(g => rangee({ lettre: initiale(g.identifiant), titre: majuscule(nomDe(g.identifiant)),
    meta: [[`a reçu ${argent(g.recu)}`, `a payé ${argent(g.paye)}`, g.envoye || g.recu_virements ? `virements ${argent(g.recu_virements - g.envoye, { signe: true })}` : ''].filter(Boolean).join(' · ')],
    action: el('span', { class: 'montant montant--grand', title: 'Ce qu’il garde' }, argent(g.net)) }))));
  const virements = a.virements || [];
  if (virements.length) {
    blocs.push(el('details', { class: 'depliant', open: ui.virements, ontoggle: e => { ui.virements = e.target.open; } },
      el('summary', null, `Virements (${virements.filter(v => !v.annule).length})`),
      el('ul', { class: 'liste' }, virements.map(v => el('li', { class: v.annule ? 'annule' : null },
        el('div', { class: 'ligne' }, el('span', { class: 'ligne__titre' }, `${majuscule(nomDe(v.de))} → ${nomDe(v.a)}`), v.annule ? badge('Annulé', 'neutre') : null,
          el('span', { class: 'montant' }, argent(v.montant))),
        el('div', { class: 'ligne' }, el('span', { class: 'ligne__meta' }, [leJour(v.date), v.note].filter(Boolean).join(' · ')),
          v.annule ? null : el('span', { class: 'ml-auto' }, confirmer(`vir-annuler:${v.id}`, 'Annuler', 'Annuler ce virement ?', async () => {
            await ecrire('virement/annuler', { id: v.id });
            toast('Virement annulé.');
          }, { classe: 'lien' }))))))));
  }
  blocs.push(el('p', { class: 'note' }, 'Chacun garde ce qu’il a reçu, moins ce qu’il a payé, plus ou moins les virements.'));
  vider(boite, blocs);
}

// ─── Paiements reçus ───────────────────────────────────────────────────────
function rendrePaiements() {
  const boite = $('#argent-paiements');
  if (!boite || attente(boite)) return;
  const a = E.argent, R = a.regles, liste = a.paiements || [];
  if (!liste.length) {
    return vider(boite, el('p', { class: 'vide' }, 'Aucun paiement pour l’instant : « Marquer payée » sur une facture le note ici.'));
  }
  // Les paiements annulés ne gênent plus la liste : ils restent (rien n'est effacé), repliés à la fin
  const actifs = liste.filter(p => !p.annule), annules = liste.filter(p => p.annule);
  const montres = ui.plusPaiements ? actifs : actifs.slice(0, 8);
  const ligneDe = p => el('li', { class: p.annule ? 'annule' : null },
      el('div', { class: 'ligne' },
        el('span', { class: 'ligne__titre' }, p.nom ? `${p.nom}${p.facture ? ` · facture ${p.facture}` : ''}` : (p.quoi || 'Revenu')),
        p.montant < 0 ? badge('Remboursement', 'neutre') : null,
        p.annule ? badge('Annulé', 'neutre') : null,
        el('span', { class: 'montant' }, argent(p.montant))),
      el('div', { class: 'ligne' },
        el('span', { class: 'ligne__meta' }, [leJour(p.date), R.modes[p.mode] || '', p.recu_par ? `${p.montant < 0 ? 'rendu par' : 'reçu par'} ${nomDe(p.recu_par)}` : '',
          p.nom && p.quoi ? p.quoi : '', p.note, p.annule && p.annule_par ? `annulé par ${nomDe(p.annule_par)}` : ''].filter(Boolean).join(' · ')),
        p.annule ? null : el('span', { class: 'ml-auto' }, confirmer(`pa-annuler:${p.id}`, 'Annuler', 'Annuler ce paiement ?', async () => {
          await ecrire('paiement/annuler', { id: p.id });
          toast(p.facture ? `Paiement annulé : la facture ${p.facture} redevient due.` : 'Paiement annulé.');
        }, { classe: 'lien' }))));
  vider(boite,
    grand(argent(a.resume.total.recu), 'reçus depuis le début', 'Ce mois-ci : ', [argent(a.resume.mois.recu)], '.'),
    actifs.length ? el('ul', { class: 'liste liste--paiements' }, montres.map(ligneDe)) : el('p', { class: 'vide' }, 'Aucun paiement actif.'),
    actifs.length > montres.length ? el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => { ui.plusPaiements = true; rendrePaiements(); } }, `Voir les ${actifs.length - montres.length} autres`) : null,
    annules.length ? el('details', { class: 'depliant', open: ui.paiementsAnnules, ontoggle: e => { ui.paiementsAnnules = e.target.open; } },
      el('summary', null, `Annulés (${annules.length})`),
      el('ul', { class: 'liste liste--paiements' }, annules.map(ligneDe))) : null);
}

// ─── Morceaux de formulaire ────────────────────────────────────────────────
const saisie = v => { const n = Number(v) || 0; return Math.round(n * 100) % 100 ? n.toFixed(2).replace('.', ',') : String(Math.round(n)); };
function lireMontant(texte) {
  const t = String(texte || '').replace(/[\s  $]/g, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100) / 100;
}
function champMontant(etiquette, valeur, { aide = '', devise = '$', facultatif = '' } = {}) {
  const c = champTexte(etiquette, { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', maxlength: 16, placeholder: '0',
    enterkeyhint: 'done', value: valeur === '' || valeur == null ? null : saisie(valeur) }, aide, facultatif);
  const enveloppe = el('div', { class: 'saisie-montant', 'data-devise': devise });
  c.input.replaceWith(enveloppe);
  enveloppe.append(c.input);
  c.devise = d => enveloppe.setAttribute('data-devise', d);
  c.lire = () => lireMontant(c.input.value);
  return c;
}
const entierDe = t => (/^\d{1,6}$/.test(String(t).trim()) ? Number(t) : NaN);

// Le panneau qui glisse de la droite : chaque envoi passe par ecrire() (l'argent recalculé revient)
const panneauFormulaire = o => panneauBase({ ...o, ecrire });

function pret() {
  if (E.argent) return true;
  toast(E.argentErreur === 'pas-encore' ? 'Le serveur n’a pas encore l’argent : il faut d’abord le mettre à jour.' : 'L’argent n’est pas encore lu. Réessaie dans un instant.', true);
  if (!E.argentErreur) chargerArgent();
  return false;
}

// ─── Panneau : un paiement reçu (facture) ou un autre revenu ───────────────
function champsPaiement({ montant = '', aide = '', libelle = 'Reçu par' } = {}) {
  const a = E.argent;
  const m = champMontant('Montant reçu', montant, { aide });
  const d = champDate('Reçu le', aujourdhui(), { max: aujourdhui() });
  const mode = pilules('Comment', Object.entries(a.regles.modes), 'interac');
  const qui = pilules(libelle, optionsPersonnes(), a.moi, undefined, { aide: 'L’agence : sur le compte commun. Ça ne compte pas dans le partage 50/50.' });
  const note = champTexte('Note', { maxlength: 200, autocomplete: 'off' }, '', 'facultatif');
  return {
    elements: [el('div', { class: 'deux' }, m.boite, d.boite), mode.boite, qui.boite, note.boite],
    montant: m,
    signature: () => [m.input.value, d.input.value, mode.lire(), qui.lire(), note.input.value].join('|'),
    lire: () => {
      const v = m.lire();
      if (v == null) throw new Invalide('Écris le montant reçu.', m.input);
      if (Number.isNaN(v) || v <= 0) throw new Invalide('Le montant est illisible : écris par exemple 199 ou 199,50.', m.input);
      if (!d.input.value) throw new Invalide('Choisis la date.', d.input);
      return { montant: v, date: d.input.value, mode: mode.lire(), recu_par: qui.lire(), note: note.input.value.trim() };
    }
  };
}

export function ouvrirPaiement({ abonnement = '', facture = 0, autre = false } = {}) {
  if (!pret()) return;
  const a = E.argent;
  let ab = null, f = null;
  if (!autre) {
    ab = a.abonnements.find(x => x.id === abonnement);
    f = ab && ab.factures.find(x => x.numero === facture);
    if (!f) return toast('Cette facture n’existe plus. Actualise l’onglet.', true);
  }
  if (E.vue !== 'argent') montrer('argent');
  const cle = nouvelleCle('pa');
  const quoi = autre ? champTexte('D’où vient cet argent ?', { maxlength: 120, autocomplete: 'off', placeholder: 'Ex. : site web pour la boulangerie Roy' }) : null;
  const c = champsPaiement(f ? { montant: f.reste, aide: f.paye > 0 ? `Il reste ${argent(f.reste)} sur ${argent(f.du)}.` : '' } : {});
  const signature = () => `${quoi ? quoi.input.value : ''}|${c.signature()}`;
  const depart = signature();
  panneauFormulaire({
    titre: autre ? 'Autre revenu' : 'Paiement reçu',
    sousTitre: f ? `${ab.nom} · facture ${f.numero} du ${leJour(f.echeance)} · ${argent(f.du)}` : 'L’argent qui ne vient pas d’un abonnement : un site, un service, une avance…',
    corps: [quoi && quoi.boite, ...c.elements],
    bouton: 'Enregistrer',
    chemin: 'paiement',
    modifie: () => signature() !== depart,
    focus: () => (quoi || c.montant).input,
    preparer: () => {
      const corps = { cle };
      if (autre) {
        corps.quoi = quoi.input.value.trim();
        if (!corps.quoi) throw new Invalide('Écris d’où vient cet argent.', quoi.input);
      } else Object.assign(corps, { abonnement: ab.id, facture: f.numero });
      return Object.assign(corps, c.lire());
    },
    reussite: () => (f ? `Paiement noté : facture ${f.numero} de ${ab.nom}.` : 'Revenu noté.')
  });
}

// ─── Panneau : un abonnement (nouveau, ou ses factures et ses réglages) ────
const COURTS = { texto: 'Texto' };

function casesAgents(v, change) {
  const connus = (E.argent && E.argent.agents_retell) || [];
  const tous = [...connus, ...v.agents.filter(id => !connus.some(x => x.id === id)).map(id => ({ id, nom: id }))];
  if (!tous.length) {
    const c = champTexte('Agents Retell', { value: v.agents.join(', ') || null, autocomplete: 'off', spellcheck: 'false', placeholder: 'agent_…' },
      'L’identifiant de l’agent dans Retell (il commence par « agent_ »), séparés par une virgule. Ses appels comptent dans les minutes du client.', 'facultatif');
    c.input.addEventListener('input', () => { v.agents = c.input.value.split(/[,\s]+/).filter(Boolean); change(); });
    return c.boite;
  }
  return el('fieldset', { class: 'cases' }, el('legend', null, 'Agents Retell', el('span', { class: 'facultatif' }, ' (facultatif)')),
    tous.map(ag => el('label', { class: 'case' },
      el('input', { type: 'checkbox', checked: v.agents.includes(ag.id),
        onchange: e => { v.agents = e.target.checked ? [...v.agents, ag.id] : v.agents.filter(x => x !== ag.id); change(); } }),
      el('span', null, el('b', null, ag.nom), el('small', null, `…${ag.id.slice(-6)}`)))),
    el('p', { class: 'champ__aide' }, 'Les appels de ces agents comptent dans ses minutes, son coût et son profit.'));
}

// Ce que le client paiera : la 1re facture, le crédit des frais, puis chaque mois
function apercuFactures(v, ab, extra) {
  const R = E.argent.regles;
  const lisible = x => x != null && !Number.isNaN(x);
  if (!v.debut || !lisible(v.mensuel) || !lisible(v.depart) || !lisible(v.blocs) || v.blocs > 40) {
    return [el('b', null, 'Aperçu des factures'), el('span', null, 'Il s’affiche quand le prix, les frais et la date sont remplis.')];
  }
  const mois = enCents(v.mensuel) + v.blocs * enCents(R.bloc_prix), depart = enCents(v.depart);
  const ligne = (gauche, droite, petit) => el('li', null, el('span', null, gauche, petit ? el('small', null, ` · ${petit}`) : null), el('b', null, droite));
  if (ab) {
    const change = ['forfait', 'mensuel', 'blocs', 'minutes'].some(k => v[k] !== ab[k]);
    if (v.debut === ab.debut && (!change || extra.application === 'prochaine')) {
      if (!change) return null;
      const n = ab.prochaine;
      // Aucune facture passée : le changement vaut pour toutes, l'aperçu complet suit
      if (n > 1) {
        return [el('b', null, 'Le changement'), el('ul', null,
          ligne(`Dès la facture ${n}`, `${argent(mois / 100)} par mois`, leJour(ajouterMois(ab.debut, n - 1))),
          ligne('Avant', `${argent(ab.total_mensuel)} par mois`, 'les factures passées ne changent pas'))];
      }
    }
  }
  let reste = v.credit ? depart : 0;
  const L = [];
  for (let n = 1; n <= 12; n++) {
    const brut = mois + (n === 1 ? depart : 0);
    let c = 0;
    if (n >= R.facture_du_credit && reste > 0) { c = Math.min(reste, brut); reste -= c; }
    L.push({ n, d: ajouterMois(v.debut, n - 1), brut, c, du: brut - c });
  }
  const lignes = [ligne(`Facture 1, le ${leJour(L[0].d)}`, argent(L[0].du / 100), depart ? `${argent(depart / 100)} de départ + ${argent(mois / 100)}` : '')];
  if (v.credit && depart) {
    const avant = L.slice(1).filter(x => x.n < R.facture_du_credit);
    if (avant.length) lignes.push(ligne(avant.length > 1 ? `Factures ${avant.map(x => x.n).join(' et ')}` : `Facture ${avant[0].n}`, argent(mois / 100)));
    L.filter(x => x.c > 0).forEach(x => lignes.push(ligne(`Facture ${x.n}, le ${leJour(x.d)}`, argent(x.du / 100), `${argent(x.c / 100)} crédités`)));
  }
  lignes.push(ligne('Ensuite, chaque mois', argent(mois / 100)));
  const regle = R.forfaits[v.forfait] || {};
  return [el('b', null, ab ? 'Toutes ses factures seront recalculées' : 'Aperçu des factures'), el('ul', null, lignes),
    regle.garantie ? el('span', { class: 'apercu__note' }, `Garantie du 1er mois : tout est remboursé, frais compris, si le client arrête avant la facture 2 (${leJour(L[1].d)}).`) : null];
}

// preset : { nom, client } pour un nouvel abonnement ouvert depuis la fiche d'un client
export function ouvrirAbonnement(id = '', preset = {}) {
  if (!pret()) return;
  if (typeof id !== 'string') id = '';                    // appelé par un bouton : l'événement
  const a = E.argent;
  const ab = id ? a.abonnements.find(x => x.id === id) : null;
  if (id && !ab) return toast('Cet abonnement n’existe plus.', true);
  if (E.vue !== 'argent') montrer('argent');
  const R = a.regles, F = R.forfaits, auj = aujourdhui();
  const v = ab
    ? { nom: ab.nom, client: ab.client, forfait: ab.forfait, mensuel: ab.mensuel, depart: ab.depart, minutes: ab.minutes, blocs: ab.blocs,
      credit: ab.credit_depart, debut: ab.debut, agents: [...ab.agents], notes: ab.notes || '' }
    : { nom: String(preset.nom || ''), client: String(preset.client || ''), forfait: 'repondeur', mensuel: F.repondeur.mensuel, depart: F.repondeur.depart, minutes: F.repondeur.minutes, blocs: 0,
      credit: F.repondeur.credit_depart, debut: auj, agents: [], notes: '' };
  const extra = { application: 'prochaine', deja: false, recu_par: a.moi };
  const initial = JSON.stringify(v);
  const cle = nouvelleCle('ab');

  const nom = champTexte('Nom du client', { value: v.nom || null, maxlength: 80, autocomplete: 'off', placeholder: 'Ex. : Plomberie Côté' });
  const clients = E.clients || [];
  const espace = liste('Son espace client', [['', 'Aucun pour l’instant'], ...clients.map(c => [c.client_id, c.project_name || c.client_id])], v.client);
  if (v.client && !clients.some(c => c.client_id === v.client)) espace.input.append(el('option', { value: v.client, selected: true }, v.client));
  const mensuel = champMontant('Prix par mois', v.mensuel);
  const depart = champMontant('Frais de départ', v.depart, { aide: ab ? 'Sur la 1re facture seulement : à changer seulement pour corriger une erreur.' : 'Sur la 1re facture, avec le 1er mois.' });
  const minutes = champTexte('Minutes incluses', { type: 'number', inputmode: 'numeric', min: 0, max: 100000, step: 1, value: String(v.minutes) });
  const blocs = champTexte(`Blocs de ${R.bloc_minutes} min en plus`, { type: 'number', inputmode: 'numeric', min: 0, max: 40, step: 1, value: String(v.blocs) },
    `${argent(R.bloc_prix)} par mois chacun.`);
  const credit = bascule('Frais de départ crédités', `Remis dès la ${R.facture_du_credit}e facture, puis sur les suivantes ; jamais remis en argent.`, v.credit, x => { v.credit = x; maj(); });
  const forfait = pilules('Forfait', Object.entries(F).map(([k, f]) => [k, f.mensuel != null ? `${COURTS[k] || f.nom} · ${argent(f.mensuel)}` : f.nom]), v.forfait, k => {
    v.forfait = k;
    const f = F[k];
    if (f.mensuel != null) { v.mensuel = f.mensuel; mensuel.input.value = saisie(f.mensuel); }
    v.minutes = f.minutes; minutes.input.value = String(f.minutes);
    if (!ab) {                                             // nouveau : les frais et le crédit suivent le forfait
      if (f.depart != null) { v.depart = f.depart; depart.input.value = saisie(f.depart); }
      v.credit = f.credit_depart; credit.input.checked = f.credit_depart;
    }
    maj();
  });
  const debut = champDate('Date de la 1re facture', v.debut, { max: ajouterJours(auj, 366), aide: 'Puis une facture par mois, le même jour.' });
  const agents = casesAgents(v, () => maj());
  const notes = champTexte('Notes', { multiligne: true, maxlength: 400, placeholder: 'Ex. : rabais promis au téléphone' }, '', 'facultatif');
  notes.input.value = v.notes;
  const deja = ab ? null : bascule('Ses factures passées sont déjà payées', 'Pour un client qui payait avant le CRM : les factures avant aujourd’hui sont notées payées.', false, x => { extra.deja = x; maj(); });
  const recu = ab ? null : pilules('Elles ont été reçues par', optionsPersonnes(), a.moi, x => { extra.recu_par = x; });
  const application = ab ? pilules('Le changement de prix vaut', [['prochaine', `Dès la prochaine facture (n° ${ab.prochaine})`], ['debut', 'Depuis le début (corriger une erreur)']],
    'prochaine', x => { extra.application = x; maj(); }) : null;
  const apercu = el('div', { class: 'info apercu', 'aria-live': 'polite' });

  nom.input.addEventListener('input', () => { v.nom = nom.input.value; maj(); });
  espace.input.addEventListener('change', () => {
    v.client = espace.input.value;
    const c = clients.find(x => x.client_id === v.client);
    if (c && !v.nom.trim()) { v.nom = c.project_name || ''; nom.input.value = v.nom; }
    maj();
  });
  mensuel.input.addEventListener('input', () => { v.mensuel = mensuel.lire(); maj(); });
  depart.input.addEventListener('input', () => { v.depart = depart.lire(); maj(); });
  minutes.input.addEventListener('input', () => { v.minutes = entierDe(minutes.input.value); maj(); });
  blocs.input.addEventListener('input', () => { v.blocs = entierDe(blocs.input.value); maj(); });
  debut.input.addEventListener('input', () => { v.debut = debut.input.value; maj(); });
  notes.input.addEventListener('input', () => { v.notes = notes.input.value; maj(); });

  // Pour un abonnement existant : son état, ses factures et sa fin, relus après chaque changement
  const zones = ab ? { resume: el('div', { class: 'bloc' }), factures: el('div', { class: 'bloc' }), fin: el('div', { class: 'bloc' }) } : null;
  let etat = null;
  const maj = () => {
    const passe = v.debut && v.debut < auj;
    if (deja) { deja.boite.hidden = !passe; recu.boite.hidden = !(passe && extra.deja); }
    if (application) {
      const change = ['forfait', 'mensuel', 'blocs', 'minutes'].some(k => v[k] !== ab[k]);
      application.boite.hidden = !(change && ab.prochaine > 1 && v.debut === ab.debut);
    }
    const contenu = apercuFactures(v, ab, extra);
    apercu.hidden = !contenu;
    vider(apercu, contenu || []);
    if (etat && etat.majPied) etat.majPied();
  };

  const corps = [
    el('div', { class: 'deux' }, nom.boite, espace.boite),
    forfait.boite,
    el('div', { class: 'deux' }, mensuel.boite, depart.boite),
    el('div', { class: 'deux' }, minutes.boite, blocs.boite),
    credit.boite, debut.boite, deja && deja.boite, recu && recu.boite, application && application.boite, apercu, agents, notes.boite];
  etat = panneauFormulaire({
    titre: ab ? ab.nom : 'Nouvel abonnement',
    sousTitre: ab ? [ab.forfait_nom, `${argent(ab.total_mensuel)} par mois`, ab.debut ? `depuis le ${leJour(ab.debut)}` : ''].filter(Boolean).join(' · ')
      : 'Un client qui paie chaque mois : ses factures se calculent toutes seules.',
    avant: ab ? [zones.resume, zones.factures, el('h3', { class: 'panneau__intertitre' }, 'Réglages de l’abonnement')] : [],
    corps,
    apres: ab ? [zones.fin] : [],
    bouton: ab ? 'Enregistrer' : 'Ajouter l’abonnement',
    chemin: 'abonnement',
    edition: !!ab,
    modifie: () => JSON.stringify(v) !== initial || (!ab && extra.deja),
    focus: () => (ab ? $('#panneau-titre') : nom.input),
    rafraichir: force => {
      if (!ab || (!force && etat.ouvert)) return;
      detailsAbonnement(etat, ab.id, zones);
    },
    preparer: () => {
      if (!v.nom.trim()) throw new Invalide('Écris le nom du client.', nom.input);
      if (v.mensuel == null || Number.isNaN(v.mensuel)) throw new Invalide('Le prix par mois est illisible : écris par exemple 199 ou 199,50.', mensuel.input);
      if (v.depart == null || Number.isNaN(v.depart)) throw new Invalide('Les frais de départ sont illisibles : écris 0 s’il n’y en a pas.', depart.input);
      if (Number.isNaN(v.minutes)) throw new Invalide('Les minutes incluses : un nombre entier.', minutes.input);
      if (Number.isNaN(v.blocs) || v.blocs > 40) throw new Invalide('Les blocs de minutes : un nombre entier, de 0 à 40.', blocs.input);
      if (!v.debut) throw new Invalide('Choisis la date de la 1re facture.', debut.input);
      const corpsDemande = { nom: v.nom.trim(), client: v.client, forfait: v.forfait, mensuel: v.mensuel, depart: v.depart, minutes: v.minutes, blocs: v.blocs,
        credit_depart: v.credit, debut: v.debut, agents: v.agents, notes: v.notes.trim() };
      if (ab) return Object.assign(corpsDemande, { id: ab.id, application: extra.application });
      return Object.assign(corpsDemande, { cle, deja_payees: !!(extra.deja && v.debut < auj), recu_par: extra.recu_par });
    },
    reussite: () => (ab ? 'Abonnement enregistré.' : `${v.nom.trim()} est ajouté : ses factures sont prêtes.`)
  });
  etat.ouvert = '';
  maj();
  if (ab) detailsAbonnement(etat, ab.id, zones);
}

function detailsAbonnement(etat, id, zones) {
  const ab = E.argent && E.argent.abonnements.find(x => x.id === id);
  if (!ab) {
    vider(zones.resume, el('p', { class: 'vide' }, 'Cet abonnement n’existe plus : il a été supprimé.'));
    vider(zones.factures); vider(zones.fin);
    return;
  }
  vider(zones.resume, resumeAbonnement(ab));
  vider(zones.factures, facturesAbonnement(etat, ab));
  vider(zones.fin, finAbonnement(etat, ab));
}

function resumeAbonnement(ab) {
  const auj = aujourdhui(), R = E.argent.regles;
  const faits = [];
  const etat = { actif: ['Actif', ''], termine: [ab.fin > auj ? `Se termine le ${leJour(ab.fin)}` : `Terminé le ${leJour(ab.fin)}`, ab.fin > auj ? 'attente' : 'neutre'],
    rembourse: ['Remboursé (garantie)', 'neutre'] }[ab.etat] || [ab.etat, 'neutre'];
  if (ab.probleme) faits.push(el('li', { class: 'faits__alerte' }, ab.probleme));
  const prochaine = ab.factures.find(f => f.numero === ab.prochaine);
  if (prochaine && ab.etat !== 'rembourse') faits.push(el('li', null, `Prochaine facture : n° ${prochaine.numero} le ${leJour(prochaine.echeance)}, `, el('b', null, argent(prochaine.du))));
  if (ab.credit.total > 0) {
    faits.push(el('li', null, ab.credit.restant <= 0 ? `Crédit des frais de départ (${argent(ab.credit.total)}) : utilisé en entier.`
      : ab.credit.utilise > 0 ? [`Crédit des frais de départ : `, el('b', null, `${argent(ab.credit.restant)} restant`), ` sur ${argent(ab.credit.total)}.`]
        : [`Crédit des frais de départ : `, el('b', null, argent(ab.credit.total)), ` dès la facture ${R.facture_du_credit} (${leJour(ab.credit.des)}).`]));
  }
  if (ab.garantie.possible) faits.push(el('li', null, 'Garantie du 1er mois : possible, si le client arrête avant la facture 2 (', leJour(ab.garantie.jusqua), ').'));
  const mins = ((E.argent.minutes && E.argent.minutes.clients) || []).find(c => c.abonnement === ab.id);
  if (mins) faits.push(el('li', null, `Ce cycle : ${nombre(mins.minutes, mins.minutes % 1 ? 1 : 0)}${mins.incluses ? ` sur ${nombre(mins.incluses)}` : ''} min, profit `, el('b', null, argent(mins.profit)), '.'));
  if (ab.conditions.length > 1) {
    faits.push(el('li', null, 'Prix : ', ab.conditions.map((c, i) => `${argent(c.mensuel + c.blocs * R.bloc_prix)} ${i ? `dès la facture ${c.des}` : `factures 1 à ${ab.conditions[1].des - 1}`}`).join(', '), '.'));
  }
  if (ab.notes) faits.push(el('li', { class: 'faits__note' }, ab.notes));
  return [el('div', { class: 'facture__haut' }, badge(etat[0], etat[1]), ab.client ? el('span', { class: 'facture__date' }, `Espace client : ${ab.client}`) : null),
    faits.length ? el('ul', { class: 'faits' }, faits) : null];
}

function facturesAbonnement(etat, ab) {
  const liste = ab.factures;
  if (!liste.length) return el('p', { class: 'vide' }, ab.debut > aujourdhui() ? `La 1re facture arrive le ${leJour(ab.debut)}.` : 'Aucune facture.');
  const montrees = etat.toutes ? liste : liste.slice(0, 6);
  return [el('h3', null, 'Factures'), el('ul', { class: 'factures' }, montrees.map(f => ligneFacture(etat, ab, f))),
    liste.length > montrees.length ? el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => { etat.toutes = true; etat.rafraichir(true); } },
      `Voir les ${liste.length - montrees.length} plus anciennes`) : null];
}

function ouvrirDansFacture(etat, quoi) {
  etat.ouvert = quoi;
  etat.rafraichir(true);
  const champ = $('#panneau-corps .facture form input:not([type=radio])');
  if (champ) champ.focus();
}

function ligneFacture(etat, ab, f) {
  const a = E.argent, R = a.regles;
  const redessiner = () => etat.rafraichir(true);
  const pays = (a.paiements || []).filter(p => f.paiements.includes(p.id));
  const details = f.de_fin ? [['Aucun mois : l’abonnement est terminé', argent(0)]]
    : [[`Mois${f.forfait !== ab.forfait ? ` (${R.forfaits[f.forfait].nom})` : ''}`, argent(f.mensuel)]];
  if (f.depart) details.push(['Frais de départ', argent(f.depart)]);
  f.ajouts.forEach(x => details.push([x.quoi, argent(x.montant), ab.etat === 'rembourse' ? null
    : confirmer(`aj-retirer:${x.id}`, 'Retirer', 'Retirer cette ligne ?', async () => { await ecrire('ajout', { abonnement: ab.id, id: x.id, retirer: true }); toast('Ligne retirée.'); },
      { classe: 'lien lien--petit', redessiner })]));
  if (f.credit) details.push(['Crédit des frais de départ', argent(-f.credit)]);
  pays.forEach(p => details.push([`${p.montant < 0 ? 'Rendu' : 'Reçu'} le ${leJour(p.date)}${p.recu_par ? ` par ${nomDe(p.recu_par)}` : ''}${R.modes[p.mode] ? ` · ${R.modes[p.mode]}` : ''}`,
    argent(p.montant), confirmer(`pa-annuler:${p.id}`, 'Annuler', 'Annuler ce paiement ?', async () => { await ecrire('paiement/annuler', { id: p.id }); toast('Paiement annulé.'); },
      { classe: 'lien lien--petit', redessiner })]));
  const peutPayer = f.reste > 0 && f.etat !== 'remboursee';
  const peutLigne = f.etat !== 'remboursee' && ab.etat !== 'rembourse' && f.jours <= 62;
  const rappel = boutonRappel(ab.id, f, 'Rappel de paiement');
  let bas = null;
  if (etat.ouvert === `payer:${f.numero}`) bas = formulairePaiementFacture(etat, ab, f);
  else if (etat.ouvert === `ligne:${f.numero}`) bas = formulaireLigne(etat, ab, f);
  else if (peutPayer || peutLigne || rappel) {
    bas = el('div', { class: 'actions' },
      peutPayer ? el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirDansFacture(etat, `payer:${f.numero}`) }, 'Marquer payée') : null,
      rappel,
      peutLigne ? el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => ouvrirDansFacture(etat, `ligne:${f.numero}`) }, 'Ajouter une ligne') : null);
  }
  return el('li', { class: `facture facture--${f.etat}` },
    el('div', { class: 'facture__haut' }, el('b', null, `Facture ${f.numero}`), el('span', { class: 'facture__date' }, leJour(f.echeance)), badgeFacture(f),
      el('span', { class: 'montant' }, argent(f.du))),
    el('ul', { class: 'facture__lignes' }, details.map(([q, m, act]) => el('li', null, el('span', { class: 'facture__quoi' }, q), act || null, el('span', { class: 'facture__combien' }, m)))),
    bas);
}

async function ecrireDansPanneau(etat, chemin, corps) {
  const r = await ecrire(chemin, corps);
  etat.ouvert = '';
  etat.rafraichir(true);
  return r;
}

function formulairePaiementFacture(etat, ab, f) {
  const c = champsPaiement({ montant: f.reste, aide: f.paye > 0 ? `Il reste ${argent(f.reste)} sur ${argent(f.du)}.` : '' });
  const cle = nouvelleCle('pa');
  return formulaireEnLigne({ elements: c.elements, bouton: 'Enregistrer le paiement',
    annuler: () => { etat.ouvert = ''; etat.rafraichir(true); },
    envoyer: async () => {
      const v = c.lire();
      await ecrireDansPanneau(etat, 'paiement', { ...v, abonnement: ab.id, facture: f.numero, cle });
      toast(`Facture ${f.numero} : paiement noté.`);
    } });
}

function formulaireLigne(etat, ab, f) {
  let sorte = 'frais';
  const genre = pilules('Sorte', [['frais', 'Frais en plus'], ['rabais', 'Rabais']], 'frais', x => { sorte = x; });
  const quoi = champTexte('Quoi', { maxlength: 120, autocomplete: 'off', placeholder: 'Ex. : 37 minutes en plus, rabais de bienvenue' });
  const m = champMontant('Montant', '');
  const cle = nouvelleCle('aj');
  return formulaireEnLigne({ elements: [genre.boite, el('div', { class: 'deux' }, quoi.boite, m.boite)], bouton: 'Ajouter à la facture',
    annuler: () => { etat.ouvert = ''; etat.rafraichir(true); },
    envoyer: async () => {
      const q = quoi.input.value.trim();
      if (!q) throw new Invalide('Écris ce que c’est.', quoi.input);
      const v = m.lire();
      if (v == null || Number.isNaN(v) || v <= 0) throw new Invalide('Écris le montant, par exemple 14,43.', m.input);
      await ecrireDansPanneau(etat, 'ajout', { abonnement: ab.id, facture: f.numero, montant: sorte === 'rabais' ? -v : v, quoi: q, cle });
      toast(`Ajouté à la facture ${f.numero}.`);
    } });
}

function finAbonnement(etat, ab) {
  const auj = aujourdhui();
  const redessiner = () => etat.rafraichir(true);
  const lignes = [];
  if (ab.etat === 'actif') {
    if (etat.ouvert === 'fin') lignes.push(formulaireFin(etat, ab));
    else {
      lignes.push(rangee({ icon: 'i-horloge', titre: 'Terminer l’abonnement', meta: ['Plus de facture à partir de la date choisie. Rien n’est effacé.'],
        action: el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => {
          etat.ouvert = 'fin'; etat.rafraichir(true);
          const champ = $('#panneau-corps .fin-abonnement input'); if (champ) champ.focus();
        } }, 'Choisir la date') }));
    }
    if (ab.garantie.possible) {
      if (etat.ouvert === 'rembourser') lignes.push(formulaireRembourser(etat, ab));
      else {
        lignes.push(rangee({ icon: 'i-ok', titre: 'Rembourser avec la garantie', meta: [`Le 1er mois satisfait ou remboursé, frais compris. Possible jusqu’au ${leJour(ajouterJours(ab.garantie.jusqua, E.argent.regles.jours_avant_retard))}.`],
          action: el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { etat.ouvert = 'rembourser'; etat.rafraichir(true); } }, 'Rembourser') }));
      }
    }
  } else if (ab.etat === 'termine') {
    lignes.push(rangee({ icon: 'i-horloge', titre: ab.fin > auj ? `Se termine le ${leJour(ab.fin)}` : `Terminé le ${leJour(ab.fin)}`, meta: ['Plus de facture à partir de cette date.'],
      action: confirmer(`reprendre:${ab.id}`, 'Reprendre', 'Annuler la fin ?', async () => {
        await ecrire('abonnement/fin', { id: ab.id, reprendre: true });
        toast('L’abonnement reprend : ses factures reviennent.');
      }, { danger: false, redessiner }) }));
  } else if (ab.etat === 'rembourse') {
    lignes.push(rangee({ icon: 'i-ok', titre: 'Remboursé avec la garantie du 1er mois', meta: [ab.fin ? `Plus de facture depuis le ${leJour(ab.fin)}.` : ''] }));
  }
  const paye = (E.argent.paiements || []).some(p => p.abonnement === ab.id && !p.annule);
  if (!paye) {
    lignes.push(rangee({ icon: 'i-fermer', titre: 'Supprimer', meta: ['Seulement pour un abonnement ajouté par erreur : il n’a aucun paiement.'],
      action: confirmer(`supprimer:${ab.id}`, 'Supprimer', 'Supprimer cet abonnement ?', async () => {
        await ecrire('abonnement/supprimer', { id: ab.id });
        etat.fini = true;
        fermerPanneau(true);
        toast('Abonnement supprimé.');
      }, { redessiner }) }));
  }
  return [el('h3', { class: 'panneau__intertitre' }, 'Fin de l’abonnement'), el('div', { class: 'rangees' }, lignes)];
}

function formulaireFin(etat, ab) {
  const payees = ab.factures.filter(f => f.paye > 0).map(f => f.numero);
  const derniere = payees.length ? Math.max(...payees) : 0;
  const min = derniere ? ajouterJours(ajouterMois(ab.debut, derniere - 1), 1) : ajouterJours(ab.debut, 1);
  const proch = ajouterMois(ab.debut, Math.max(1, ab.prochaine) - 1);
  const d = champDate('Plus de facture à partir du', proch > min ? proch : min, { min, max: ajouterJours(aujourdhui(), 366),
    aide: derniere ? `Après le ${leJour(ajouterMois(ab.debut, derniere - 1))} : la facture ${derniere} est déjà payée.` : '' });
  const info = el('p', { class: 'champ__aide', 'aria-live': 'polite' });
  const maj = () => {
    const fin = d.input.value;
    let n = 0;
    while (fin && n < 1200 && ajouterMois(ab.debut, n) < fin) n++;
    const suite = n ? ab.factures.find(x => x.numero === n + 1) : null;
    const enPlus = suite ? suite.ajouts.reduce((t, x) => t + x.montant, 0) : 0;
    info.textContent = (!fin ? '' : n ? fr(`Dernière facture : la n° ${n}, du ${leJour(ajouterMois(ab.debut, n - 1))}.`) : 'Aucune facture.')
      + (fin && enPlus > 0 ? fr(` La facture ${n + 1} reste, avec ses lignes en plus seulement (${argent(enPlus)}).`) : '');
  };
  d.input.addEventListener('input', maj);
  maj();
  const form = formulaireEnLigne({ elements: [d.boite, info], bouton: 'Terminer l’abonnement', danger: true,
    annuler: () => { etat.ouvert = ''; etat.rafraichir(true); },
    envoyer: async () => {
      if (!d.input.value) throw new Invalide('Choisis la date.', d.input);
      await ecrireDansPanneau(etat, 'abonnement/fin', { id: ab.id, fin: d.input.value });
      toast(`Abonnement terminé. ${info.textContent}`);
    } });
  form.classList.add('fin-abonnement');
  return form;
}

function formulaireRembourser(etat, ab) {
  const a = E.argent, auj = aujourdhui();
  const f1 = ab.factures.find(x => x.numero === 1);
  const rendre = f1 ? Math.max(0, f1.paye - f1.rendu) : 0;
  const mode = pilules('Comment', Object.entries(a.regles.modes), 'interac');
  const qui = pilules('Rendu par', optionsPersonnes(), a.moi);
  const d = champDate('Rendu le', auj, { max: auj });
  const cle = nouvelleCle('pa');
  const texte = rendre > 0
    ? `On rend ${argent(rendre)} : tout ce qui a été payé sur la facture 1, frais de départ compris. L’abonnement s’arrête, sans autre facture.`
    : 'Rien n’a encore été payé : l’abonnement s’arrête simplement, sans autre facture.';
  return formulaireEnLigne({ elements: [el('p', { class: 'champ__aide' }, texte), ...(rendre > 0 ? [mode.boite, qui.boite, d.boite] : [])],
    bouton: rendre > 0 ? `Rembourser ${argent(rendre)}` : 'Arrêter avec la garantie', danger: true,
    annuler: () => { etat.ouvert = ''; etat.rafraichir(true); },
    envoyer: async () => {
      await ecrireDansPanneau(etat, 'abonnement/rembourser', { id: ab.id, mode: mode.lire(), par: qui.lire(), date: d.input.value || auj, cle });
      toast(rendre > 0 ? `Remboursement de ${argent(rendre)} noté : l’abonnement est arrêté.` : 'L’abonnement est arrêté avec la garantie.');
    } });
}

// ─── Panneau : une dépense ─────────────────────────────────────────────────
export function ouvrirDepense(id = '', preset = {}) {
  if (!pret()) return;
  const a = E.argent;
  const d = id ? a.depenses.find(x => x.id === id) : null;
  if (id && !d) return toast('Cette dépense n’existe plus.', true);
  if (E.vue !== 'argent') montrer('argent');
  const R = a.regles, auj = aujourdhui();
  const v = d
    ? { quoi: d.quoi, montant: d.montant, devise: d.devise, frequence: d.frequence, categorie: d.categorie, payeur: d.payeur || a.moi, debut: d.debut,
      fin: d.fin, service: d.service || '', credit_usd: d.credit_usd || '', note: d.note || '' }
    : { quoi: '', montant: '', devise: 'CAD', frequence: 'unique', categorie: 'autre', payeur: a.moi, debut: auj, fin: '', service: '', credit_usd: '', note: '', ...preset };
  const taux = d && d.devise === 'USD' ? d.taux : a.taux_usd_cad;
  const cle = nouvelleCle('de');
  const quoi = champTexte('Quoi', { value: v.quoi || null, maxlength: 80, autocomplete: 'off', placeholder: 'Ex. : Recharge Retell, domaine agenceuio.ca' });
  const montant = champMontant('Montant', v.montant, { devise: v.devise === 'USD' ? '$ US' : '$' });
  const conversion = el('p', { class: 'champ__aide', 'aria-live': 'polite' });
  montant.boite.append(conversion);
  const devise = pilules('Devise', [['CAD', '$ canadiens'], ['USD', '$ américains']], v.devise, x => { v.devise = x; montant.devise(x === 'USD' ? '$ US' : '$'); maj(); });
  const frequence = pilules('Revient', Object.entries(R.frequences), v.frequence, x => { v.frequence = x; maj(); });
  const categorie = liste('Catégorie', Object.entries(R.categories), v.categorie);
  const payeur = pilules('Payé par', optionsPersonnes(), v.payeur, x => { v.payeur = x; }, { aide: 'L’agence : payé avec l’argent commun. Ça ne compte pas dans le partage 50/50.' });
  const debut = champDate('Date', v.debut, { max: ajouterJours(auj, 366) });
  const fin = champDate('S’arrête le', v.fin, { aide: 'Plus de paiement à partir de cette date. Vide : elle continue.', facultatif: 'facultatif' });
  // Une recharge : on remplit ce qui est encore vide (quoi, catégorie, devise), sans rien écraser
  const service = pilules('C’est une recharge de crédit ?', [['', 'Non'], ...Object.entries(R.services)], v.service, x => {
    v.service = x;
    const r = RECHARGES[x];
    if (r) {
      if (categorie.input.value === 'autre') categorie.input.value = r.categorie;
      if (!quoi.input.value.trim()) quoi.input.value = r.quoi;
      if (!montant.input.value.trim() && v.devise !== r.devise) { v.devise = r.devise; devise.choisir(r.devise); montant.devise(r.devise === 'USD' ? '$ US' : '$'); }
    }
    maj();
  }, { aide: 'Pour suivre le crédit qui reste (carte Crédits).' });
  const credit = champMontant('Crédit ajouté', v.credit_usd, { devise: '$ US', aide: 'Seulement s’il diffère du montant payé (taxes, frais de change).', facultatif: 'facultatif' });
  const note = champTexte('Note', { value: v.note || null, maxlength: 200, autocomplete: 'off' }, '', 'facultatif');
  const signature = () => [quoi.input.value, montant.input.value, v.devise, v.frequence, categorie.input.value, payeur.lire(), debut.input.value, fin.input.value,
    v.service, credit.input.value, note.input.value].join('|');
  const depart = signature();
  let etat = null;
  const maj = () => {
    fin.boite.hidden = v.frequence === 'unique';
    debut.etiquette.textContent = v.frequence === 'unique' ? 'Date' : 'Premier paiement';
    credit.boite.hidden = !v.service;
    const m = montant.lire();
    conversion.textContent = v.devise === 'USD' && m > 0
      ? `Environ ${argent(m * taux, { cents: true })} au taux ${d && d.devise === 'USD' ? 'gardé avec la dépense' : 'du jour'} (1 $ US = ${nombre(taux, 4)} $).` : '';
    if (etat && etat.majPied) etat.majPied();
  };
  montant.input.addEventListener('input', maj);

  const zoneRetirer = el('div', { class: 'bloc' });
  const blocRetirer = () => vider(zoneRetirer, el('h3', { class: 'panneau__intertitre' }, 'Retirer'), el('div', { class: 'rangees' },
    rangee({ icon: 'i-fermer', titre: 'Retirer cette dépense', meta: ['Elle ne compte plus nulle part. Rien n’est effacé : c’est noté au journal.'],
      action: confirmer(`de-retirer:${d.id}`, 'Retirer', 'Retirer cette dépense ?', async () => {
        await ecrire('depense/retirer', { id: d.id });
        etat.fini = true;
        fermerPanneau(true);
        toast('Dépense retirée.');
      }, { redessiner: blocRetirer }) })));
  if (d) blocRetirer();

  etat = panneauFormulaire({
    titre: d ? d.quoi : (v.service ? v.quoi : 'Nouvelle dépense'),
    sousTitre: d ? `${R.categories[d.categorie]} · ajoutée par ${nomDe(d.cree_par) || 'quelqu’un'}` : 'Ce que l’agence paie, et qui l’a payé : le partage 50/50 suit tout seul.',
    corps: [quoi.boite, el('div', { class: 'deux' }, montant.boite, devise.boite), frequence.boite, categorie.boite, payeur.boite,
      el('div', { class: 'deux' }, debut.boite, fin.boite), service.boite, credit.boite, note.boite],
    apres: d ? [zoneRetirer] : [],
    bouton: d ? 'Enregistrer' : 'Ajouter la dépense',
    chemin: 'depense',
    edition: !!d,
    modifie: () => signature() !== depart,
    focus: () => (v.quoi ? montant.input : quoi.input),
    preparer: () => {
      const q = quoi.input.value.trim();
      if (!q) throw new Invalide('Écris ce que c’est.', quoi.input);
      const m = montant.lire();
      if (m == null) throw new Invalide('Écris le montant.', montant.input);
      if (Number.isNaN(m) || m <= 0) throw new Invalide('Le montant est illisible : écris par exemple 20 ou 27,60.', montant.input);
      if (!debut.input.value) throw new Invalide('Choisis la date.', debut.input);
      const arret = v.frequence === 'unique' ? '' : fin.input.value;
      if (arret && arret <= debut.input.value) throw new Invalide('La date d’arrêt doit venir après le premier paiement.', fin.input);
      const corps = { quoi: q, montant: m, devise: v.devise, frequence: v.frequence, categorie: categorie.input.value, payeur: payeur.lire(),
        debut: debut.input.value, fin: arret, service: v.service, note: note.input.value.trim() };
      if (v.service) {
        const c = credit.lire();
        if (Number.isNaN(c)) throw new Invalide('Le crédit ajouté est illisible : écris par exemple 20.', credit.input);
        if (c != null) corps.credit_usd = c;
      }
      return Object.assign(corps, d ? { id: d.id } : { cle });
    },
    reussite: () => (d ? 'Dépense enregistrée.' : 'Dépense ajoutée.')
  });
  maj();
}

// ─── Panneau : un virement entre associés ──────────────────────────────────
export function ouvrirVirement(preset = {}) {
  if (!pret()) return;
  const a = E.argent;
  if (E.vue !== 'argent') montrer('argent');
  const gens = optionsPersonnes();
  const autre = (gens.find(([i]) => i !== a.moi && i !== 'agence') || [])[0] || '';
  const de = pilules('De', gens, preset.de || a.moi);
  const vers = pilules('À', gens, preset.a || autre);
  const m = champMontant('Montant', preset.montant || '');
  const d = champDate('Envoyé le', aujourdhui(), { max: aujourdhui() });
  const note = champTexte('Note', { maxlength: 200, autocomplete: 'off', placeholder: 'Ex. : partage 50/50 d’octobre' }, '', 'facultatif');
  const cle = nouvelleCle('vi');
  const signature = () => [de.lire(), vers.lire(), m.input.value, d.input.value, note.input.value].join('|');
  const depart = signature();
  panneauFormulaire({
    titre: 'Virement entre associés',
    sousTitre: 'L’argent envoyé de l’un à l’autre, ou au compte de l’agence, pour équilibrer le partage.',
    corps: [de.boite, vers.boite, el('div', { class: 'deux' }, m.boite, d.boite), note.boite],
    bouton: 'Enregistrer',
    chemin: 'virement',
    modifie: () => signature() !== depart,
    focus: () => m.input,
    preparer: () => {
      if (de.lire() === vers.lire()) throw new Invalide('Choisis deux personnes différentes.', vers.premier());
      const v = m.lire();
      if (v == null) throw new Invalide('Écris le montant envoyé.', m.input);
      if (Number.isNaN(v) || v <= 0) throw new Invalide('Le montant est illisible : écris par exemple 42 ou 42,50.', m.input);
      if (!d.input.value) throw new Invalide('Choisis la date.', d.input);
      return { de: de.lire(), a: vers.lire(), montant: v, date: d.input.value, note: note.input.value.trim(), cle };
    },
    reussite: 'Virement noté.'
  });
}
