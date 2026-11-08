// Équipe : les tâches entre associés (et leurs Claude), les récaps « Qui a fait quoi » avec
// leurs réactions et leurs notes, les heures de chacun (le chrono de l'app et les sessions des
// récaps, jamais comptées deux fois), les documents importants, et les clés pour brancher
// son Claude. Le serveur garde tout dans la feuille du portail ; l'app montre et envoie.
// Chaque ajout porte une clé tirée au hasard : envoyé deux fois, il n'est ajouté qu'une fois.
import { $, $$, icone, vider, pluriel, majuscule, date, relatif, heure, ymd, toast, copier, urlSure, FUSEAU } from './outils.js';
import { E, BACKEND } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { ouvrirPanneau, fermerPanneau } from './panneau.js';
import { depliant } from './ui.js';
import { prenom, rendreBonjour } from './tableau.js';
import { fr, el, Invalide, nouvelleCle, dureeHM, badge, rangee, confirmations, champTexte, champDate, pilules, formulaireEnLigne,
  panneauFormulaire as panneauBase } from './formes.js';

const ui = { construit: false, charge: null, confirmer: '', filtre: 'moi', plusTaches: false, recapsMontres: 6,
  emoji: '', note: '', chrono: false, brouillons: new Map(), clesNotes: new Map() };
const TOUS = 'tous';
const DOMAINE = new URL(BACKEND).host;

// ─── Personnes, dates et durées ────────────────────────────────────────────
const moi = () => (E.equipe && E.equipe.moi) || ((sessionActuelle() || {}).admin || {}).identifiant || '';
const gens = () => (E.equipe && E.equipe.personnes) || [];
const autres = () => gens().filter(p => p.identifiant !== moi());
const prenomDe = id => { const p = gens().find(x => x.identifiant === id); return p ? prenom(p.nom) || p.nom : id; };
const monPrenom = () => prenomDe(moi()) || prenom(((sessionActuelle() || {}).admin || {}).nom);
// « toi », « Alex », « tout le monde »
const quiEst = (id, nom = '') => (id === TOUS ? 'tout le monde' : id === moi() ? 'toi' : prenom(nom) || prenomDe(id));
const Qui = (id, nom = '') => majuscule(quiEst(id, nom));
// Une couleur par personne, la même sur tous les téléphones (ordre des identifiants)
function teinte(id) {
  const ids = gens().map(p => p.identifiant).sort();
  return 'abcd'[Math.max(0, ids.indexOf(id)) % 4];
}
const avatar = (id, nom) => el('span', { class: `avatar avatar--${teinte(id)}`, 'aria-hidden': 'true' },
  (prenom(nom) || prenomDe(id) || '?').charAt(0).toUpperCase());

const jourIso = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const aujourdhui = () => ymd(new Date());
function jourCourt(iso) {
  const d = jourIso(iso);
  if (isNaN(d)) return '';
  const o = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  if (String(iso).slice(0, 4) !== aujourdhui().slice(0, 4)) o.year = 'numeric';
  return d.toLocaleDateString('fr-CA', o);
}
const ecartJours = iso => Math.round((jourIso(iso) - jourIso(aujourdhui())) / 864e5);
function pourQuand(iso) {
  const n = ecartJours(iso);
  if (n === 0) return 'pour aujourd’hui';
  if (n === 1) return 'pour demain';
  if (n > 1 && n < 7) return `pour ${jourIso(iso).toLocaleDateString('fr-CA', { timeZone: 'UTC', weekday: 'long' })}`;
  return `pour le ${jourCourt(iso)}`;
}
// « il y a 2 h », « hier à 22 h 40 », « le 8 novembre »
const quand = d => { if (!d) return ''; const r = relatif(d); return /^\d/.test(r) ? `le ${r}` : r; };
const nomDuJour = iso => (iso === aujourdhui() ? 'aujourd’hui'
  : jourIso(iso).toLocaleDateString('fr-CA', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }));
const jourHeure = d => majuscule(d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, weekday: 'short', day: 'numeric', month: 'short' }));
// Pour <input type="datetime-local"> : « 2026-11-08T20:10 », à l'heure du Québec
function versLocal(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const arrondi5 = ms => new Date(Math.floor(ms / 300e3) * 300e3);
const lignesDe = t => String(t || '').split('\n').map(x => x.replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean);
const hote = u => { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).slice(0, 48); } catch (e) { return u; } };

// ─── Lecture et écriture ───────────────────────────────────────────────────
export function chargerEquipe({ frais = false, auto = false } = {}) {
  // Jamais par-dessus ce qu'on est en train d'écrire (panneau, note, confirmation)
  const a = document.activeElement;
  const tape = a && a.closest && a.closest('#vue-equipe form, #vue-equipe .emojis, #panneau form');
  if (auto && ((E.panneau && E.panneau.modifie && E.panneau.modifie()) || ui.confirmer || ui.note || ui.emoji || tape)) return Promise.resolve();
  if (ui.charge) return ui.charge;
  const s = sessionActuelle();
  if (E.equipe) $$('#vue-equipe .carte').forEach(c => c.classList.add('lit'));
  ui.charge = api('/portal/admin/equipe' + (frais ? '?frais=1' : ''), { delai: 60000 })
    .then(d => { if (sessionActuelle() === s) { E.equipe = d; E.equipeErreur = ''; E.equipeLu = Date.now(); } })
    .catch(e => { if (e.statut !== 401 && sessionActuelle() === s) E.equipeErreur = e.statut === 404 ? 'pas-encore' : e.message; })
    .finally(() => {
      ui.charge = null;
      $$('#vue-equipe .lit').forEach(c => c.classList.remove('lit'));
      if (sessionActuelle() !== s || (!E.equipe && !E.equipeErreur)) return;
      rendreEquipe();
      rendreBonjour();
      if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
    });
  return ui.charge;
}

// Chaque changement renvoie toute l'équipe : l'écran suit tout de suite.
async function ecrire(chemin, corps) {
  const s = sessionActuelle();
  const r = await api(`/portal/admin/equipe/${chemin}`, { methode: 'POST', corps, delai: 45000 });
  if (sessionActuelle() !== s) return r;
  if (r.equipe) { E.equipe = r.equipe; E.equipeErreur = ''; E.equipeLu = Date.now(); }
  rendreEquipe();
  rendreBonjour();
  if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
  return r;
}
const panneauFormulaire = o => panneauBase({ ...o, ecrire });

export function viderEquipe() {
  E.equipe = null; E.equipeErreur = ''; E.equipeLu = 0;
  Object.assign(ui, { confirmer: '', filtre: 'moi', plusTaches: false, recapsMontres: 6, emoji: '', note: '', chrono: false });
  ui.brouillons.clear(); ui.clesNotes.clear();
  if (ui.construit) rendreEquipe();
}

function pret() {
  if (E.equipe) return true;
  toast(E.equipeErreur === 'pas-encore' ? 'Le serveur n’a pas encore l’équipe : il faut d’abord le mettre à jour.' : 'L’équipe n’est pas encore lue. Réessaie dans un instant.', true);
  if (!E.equipeErreur) chargerEquipe();
  return false;
}
function attente(boite) {
  if (E.equipe) return false;
  vider(boite, el('p', { class: 'vide' }, E.equipeErreur === 'pas-encore'
    ? 'L’équipe s’affichera ici dès que le serveur aura reçu sa mise à jour.' : E.equipeErreur || 'Lecture en cours…'));
  return true;
}

// Après un nouveau dessin, le focus revient sur le même bouton (clavier, lecteur d'écran)
function garderFocus(fn) {
  const a = document.activeElement;
  const cle = a && a.dataset && a.dataset.focus ? a.dataset.focus : '';
  fn();
  if (!cle || (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.focus === cle)) return;
  const n = document.querySelector(`[data-focus="${CSS.escape(cle)}"]`);
  if (n) n.focus({ preventScroll: true });
}

const confirmer = confirmations(ui, () => rendreEquipe());

// ─── La page ───────────────────────────────────────────────────────────────
function construire() {
  if (ui.construit) return;
  ui.construit = true;
  const carte = (classe, id, titre, ...tete) => el('article', { class: `carte ${classe}`, id: `carte-${id}`, 'aria-labelledby': `t-${id}` },
    el('div', { class: 'carte__tete' }, el('h2', { id: `t-${id}` }, titre), ...tete),
    el('div', { class: 'carte__corps', id: `equipe-${id}` }));
  const lien = (texte, onclick) => el('button', { class: 'lien', type: 'button', onclick }, texte);
  vider($('#vue-equipe'),
    el('div', { class: 'equipe__tete' },
      el('div', { class: 'equipe__titre' }, el('h1', null, 'Équipe'), el('p', { id: 'equipe-phrase' }, 'Lecture de l’équipe…')),
      el('div', { class: 'equipe__actions' },
        el('button', { class: 'btn btn--petit btn--sombre chrono', type: 'button', id: 'chrono', onclick: basculerChrono }, icone('i-lecture'), 'Je commence'),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirTache() }, icone('i-plus'), 'Tâche'),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirRecap() }, icone('i-plus'), 'Récap'),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirCollage() }, icone('i-coller'), 'Coller de Claude'))),
    el('div', { class: 'grille' },
      carte('carte--taches l7', 'taches', 'Tâches', lien('Ajouter', () => ouvrirTache())),
      carte('carte--heures l5', 'heures', 'Heures', lien('Mes heures', () => ouvrirHeures())),
      carte('carte--recaps l7', 'recaps', 'Qui a fait quoi', lien('Écrire un récap', () => ouvrirRecap())),
      el('div', { class: 'pile l5' },
        carte('carte--documents', 'documents', 'Documents', lien('Ajouter', () => ouvrirDocument())),
        carte('carte--claude', 'claude', 'Brancher mon Claude'))));
}

export function rendreEquipe() {
  if (!$('#vue-equipe')) return;                 // une page d'une version plus ancienne (mise à jour en cours)
  construire();
  garderFocus(() => { rendreTete(); rendreChrono(); rendreTaches(); rendreHeures(); rendreRecaps(); rendreDocuments(); rendreClaude(); });
}

const ouvertes = () => (E.equipe ? E.equipe.taches.filter(t => t.statut === 'a_faire' || t.statut === 'en_cours') : []);
const tachesPourMoi = () => ouvertes().filter(t => t.pour === moi() || t.pour === TOUS);
const tachesDesAutres = () => ouvertes().filter(t => t.pour !== moi() && t.pour !== TOUS);
const faites = () => (E.equipe ? E.equipe.taches.filter(t => t.statut === 'fait') : []);
const trouverTache = id => (E.equipe ? E.equipe.taches.find(t => t.id === id) : null);
const mesHeures = () => (E.equipe ? E.equipe.heures.personnes.find(p => p.identifiant === moi()) : null);

function rendreTete() {
  const p = $('#equipe-phrase');
  if (!p) return;
  const q = E.equipe;
  if (!q) {
    p.textContent = fr(E.equipeErreur === 'pas-encore' ? 'Bientôt : le serveur doit d’abord recevoir sa mise à jour.' : (E.equipeErreur || 'Lecture de l’équipe…'));
    return;
  }
  const b = t => el('b', null, t);
  const miennes = tachesPourMoi();
  const urgentes = miennes.filter(t => t.priorite === 'urgente').length, retard = miennes.filter(t => t.en_retard > 0).length;
  const morceaux = [];
  if (miennes.length) {
    morceaux.push(b(pluriel(miennes.length, 'tâche', 'tâches')), ' pour toi');
    const plus = [urgentes ? pluriel(urgentes, 'urgente', 'urgentes') : '', retard ? `${retard} en retard` : ''].filter(Boolean);
    if (plus.length) morceaux.push(', dont ', el('b', { class: 'attention' }, plus.join(' et ')));
    morceaux.push('. ');
  } else morceaux.push('Rien à faire pour toi en ce moment. ');
  const h = q.heures.personnes;
  if (h.length) {
    morceaux.push('Cette semaine : ');
    h.forEach((x, i) => { if (i) morceaux.push(i === h.length - 1 ? ' et ' : ', '); morceaux.push(b(dureeHM(x.semaine)), ` pour ${quiEst(x.identifiant, x.nom)}`); });
    morceaux.push('.');
  }
  const g = date(q.genere_a);
  vider(p, morceaux, g ? el('span', { class: 'equipe__maj' }, `Lu à ${heure(g)}`) : null);
}

// ─── Le chrono : « Je commence », « J'arrête » ─────────────────────────────
export function rendreChrono() {
  const b = $('#chrono');
  if (!b) return;
  const enCours = (mesHeures() || {}).en_cours;
  b.disabled = !E.equipe || ui.chrono;
  b.classList.toggle('btn--sombre', !enCours);
  b.classList.toggle('chrono--actif', !!enCours);
  b.setAttribute('aria-busy', String(ui.chrono));
  if (ui.chrono) return vider(b, el('span', { class: 'roue roue--petite', 'aria-hidden': 'true' }), enCours ? 'Arrêt…' : 'Départ…');
  if (!enCours) {
    b.setAttribute('aria-label', 'Je commence : le chrono compte mes heures');
    return vider(b, icone('i-lecture'), 'Je commence');
  }
  const min = Math.max(0, (Date.now() - Date.parse(enCours.debut)) / 60000);
  const long = min > E.equipe.regles.session_max_h * 60;
  b.setAttribute('aria-label', `J’arrête le chrono, commencé à ${heure(new Date(enCours.debut))}`);
  vider(b, el('i', { class: 'chrono__point', 'aria-hidden': 'true' }), 'J’arrête',
    el('span', { class: 'chrono__temps' }, long ? `plus de ${E.equipe.regles.session_max_h} h` : dureeHM(min)));
}
async function basculerChrono() {
  if (!pret() || ui.chrono) return;
  const enCours = (mesHeures() || {}).en_cours;
  ui.chrono = true;
  rendreChrono();
  try {
    const r = await ecrire('chrono', enCours ? { action: 'fin' } : { action: 'debut', cle: nouvelleCle('he') });
    if (enCours) toast(r.message || (r.deja ? 'Le chrono était déjà arrêté.' : `Session de ${dureeHM(r.minutes)} ajoutée à tes heures.`));
    else toast(r.deja ? 'Ton chrono tournait déjà.' : 'C’est parti : le chrono compte tes heures.');
  } catch (e) { if (e.statut !== 401) toast(e.message || 'Ça n’a pas marché. Réessaie.', true); }
  finally { ui.chrono = false; rendreChrono(); }
}

// ─── Tâches ────────────────────────────────────────────────────────────────
function rendreTaches() {
  const boite = $('#equipe-taches');
  if (!boite || attente(boite)) return;
  const a = autres();
  const lui = a.length === 1 ? prenom(a[0].nom) || a[0].identifiant : '';
  const groupes = { moi: tachesPourMoi(), autres: tachesDesAutres(), faites: faites() };
  if (!groupes[ui.filtre]) ui.filtre = 'moi';
  const filtres = el('div', { class: 'filtres', role: 'group', 'aria-label': 'Montrer les tâches' },
    [['moi', 'Pour moi'], ['autres', lui ? `Pour ${lui}` : 'Pour les autres'], ['faites', 'Faites']].map(([v, t]) =>
      el('button', { class: 'filtre', type: 'button', 'aria-pressed': String(ui.filtre === v), 'data-focus': `filtre-${v}`,
        onclick: () => { ui.filtre = v; ui.plusTaches = false; rendreEquipe(); } },
      t, el('span', { class: 'filtre__n' }, String(groupes[v].length)))));
  const liste = groupes[ui.filtre];
  const max = ui.plusTaches ? 200 : 7;
  const vides = { moi: 'Rien pour toi en ce moment.', autres: lui ? `Aucune tâche pour ${lui}.` : 'Aucune tâche pour les autres.',
    faites: 'Aucune tâche faite ces 30 derniers jours.' };
  const ajouter = ui.filtre === 'faites' ? null : el('button', { class: 'lien-texte', type: 'button',
    onclick: () => ouvrirTache({ pour: ui.filtre === 'autres' && a.length === 1 ? a[0].identifiant : moi() }) }, 'Ajouter une tâche');
  vider(boite, filtres,
    liste.length ? el('ul', { class: 'taches' }, liste.slice(0, max).map(ligneTache)) : el('p', { class: 'vide' }, vides[ui.filtre], ajouter ? [' ', ajouter, '.'] : null),
    liste.length > max ? el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', onclick: () => { ui.plusTaches = true; rendreEquipe(); } },
      `Voir les ${liste.length - max} autres`) : null);
}

function quiTache(t) {
  if (t.de === t.pour) return `Pour ${quiEst(t.pour, t.pour_nom)}`;
  if (t.pour === moi()) return `De ${quiEst(t.de, t.de_nom)}`;
  return `De ${quiEst(t.de, t.de_nom)}, pour ${quiEst(t.pour, t.pour_nom)}`;
}
const PAR = { claude: 'par Claude', collage: 'collée de Claude' };

function ligneTache(t) {
  const fait = t.statut === 'fait';
  const badges = [];
  if (!fait) {
    if (t.priorite === 'urgente') badges.push(badge('Urgente', 'alerte'));
    if (t.statut === 'en_cours') badges.push(badge('En cours', 'bleu'));
    if (t.en_retard > 0) badges.push(badge(t.en_retard === 1 ? 'En retard d’un jour' : `En retard de ${t.en_retard} j`, 'alerte'));
    else if (t.echeance) badges.push(badge(majuscule(pourQuand(t.echeance)), ecartJours(t.echeance) <= 1 ? 'attente' : 'neutre'));
  }
  const meta = fait ? [`Faite ${quand(date(t.fait_le))}`, quiTache(t)] : [quiTache(t), quand(date(t.cree_le)), PAR[t.source]];
  const caseFaite = el('button', { class: 'tache__case', type: 'button', role: 'checkbox', 'aria-checked': String(fait),
    'aria-label': `Faite : ${t.titre}`, 'data-focus': `case-${t.id}`, onclick: () => cocher(t, caseFaite) }, icone('i-ok'));
  return el('li', { class: `tache${!fait && t.priorite === 'urgente' ? ' tache--urgente' : ''}${fait ? ' tache--faite' : ''}`, 'data-id': t.id },
    caseFaite,
    el('button', { class: 'tache__corps', type: 'button', 'data-focus': `tache-${t.id}`, onclick: () => ouvrirTache(t.id) },
      el('span', { class: 'tache__titre' }, t.titre),
      badges.length ? el('span', { class: 'tache__badges' }, badges) : null,
      el('span', { class: 'tache__meta' }, meta.filter(Boolean).join(' · '),
        t.notes.length ? el('span', { class: 'tache__notes' }, icone('i-note'), el('span', { class: 'sr' }, 'Notes : '), String(t.notes.length)) : null)));
}

// Cocher : la tâche est faite (ou rouverte) ; le focus passe à la tâche suivante
async function cocher(t, bouton) {
  if (bouton.getAttribute('aria-busy') === 'true') return;
  const fait = t.statut === 'fait';
  const li = bouton.closest('li');
  const voisin = li && (li.nextElementSibling || li.previousElementSibling);
  const suite = voisin ? voisin.querySelector('.tache__case') : null;
  const cleSuite = suite ? suite.dataset.focus : 'filtre-' + ui.filtre;
  bouton.setAttribute('aria-busy', 'true');
  bouton.setAttribute('aria-checked', String(!fait));
  if (li) li.classList.add(fait ? 'tache--rouvre' : 'tache--coche');
  try {
    await ecrire('tache', { id: t.id, statut: fait ? 'a_faire' : 'fait' });
    toast(fait ? 'Tâche remise à faire.' : 'Tâche faite.');
    const n = document.querySelector(`[data-focus="${CSS.escape(cleSuite)}"]`);
    if (n && document.activeElement === document.body) n.focus({ preventScroll: true });
  } catch (e) {
    bouton.removeAttribute('aria-busy');
    bouton.setAttribute('aria-checked', String(fait));
    if (li) li.classList.remove('tache--coche', 'tache--rouvre');
    if (e.statut !== 401) toast(e.message || 'Ça n’a pas marché. Réessaie.', true);
  }
}

// ─── Panneau : une tâche (nouvelle, ou à changer) ──────────────────────────
export function ouvrirTache(arg = '') {
  if (!pret()) return;
  const id = typeof arg === 'string' ? arg : '';
  const preset = arg && typeof arg === 'object' ? arg : {};
  const t = id ? trouverTache(id) : null;
  if (id && !t) return toast('Cette tâche n’existe plus.', true);
  const m = moi();
  const options = [[m, 'Moi'], ...autres().map(p => [p.identifiant, prenom(p.nom) || p.identifiant]), [TOUS, 'Tout le monde']];
  if (t && !options.some(o => o[0] === t.pour)) options.push([t.pour, prenom(t.pour_nom) || t.pour]);
  const titre = champTexte('La tâche', { maxlength: 140, autocomplete: 'off', enterkeyhint: 'next', placeholder: 'Ex. : Rappeler le client pour ses heures de garde' });
  titre.input.value = t ? t.titre : (preset.titre || '');
  const pour = pilules('Pour qui', options, t ? t.pour : (preset.pour || m), undefined,
    { aide: 'Pour quelqu’un d’autre : un courriel le dit aussi à la boîte de l’agence.' });
  const priorite = pilules('Priorité', [['normale', 'Normale'], ['urgente', 'Urgente']], t ? t.priorite : 'normale');
  const statut = t ? pilules('Où ça en est', [['a_faire', 'À faire'], ['en_cours', 'En cours'], ['fait', 'Faite']], t.statut === 'annule' ? 'a_faire' : t.statut) : null;
  const passee = t && t.echeance && t.echeance < aujourdhui();
  const echeance = champDate('Pour quand', t ? t.echeance : '', { min: passee ? undefined : aujourdhui(), facultatif: 'facultatif' });
  const details = champTexte('Détails', { multiligne: true, maxlength: 2000, rows: 4, placeholder: 'Ce qu’il faut savoir pour la faire' }, '', 'facultatif');
  details.input.value = t ? t.details : '';
  const lien = champTexte('Lien', { type: 'url', inputmode: 'url', maxlength: 500, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none',
    placeholder: 'https://…' }, 'Un document, un dossier Drive, une demande de fusion…', 'facultatif');
  lien.input.value = t ? t.lien : '';
  const valeurs = () => ({ titre: titre.input.value.trim(), pour: pour.lire(), priorite: priorite.lire(), statut: statut ? statut.lire() : 'a_faire',
    echeance: echeance.input.value, details: details.input.value.trim(), lien: lien.input.value.trim() });
  const depart = valeurs();
  const cle = nouvelleCle('ta');

  const avant = [], apres = [];
  let dessinerNotes = () => {};
  if (t) {
    const b = x => el('b', null, x);
    avant.push(el('ul', { class: 'faits' },
      el('li', null, 'Créée ', quand(date(t.cree_le)), ' par ', b(quiEst(t.de, t.de_nom)), PAR[t.source] ? ` (${PAR[t.source]})` : '', '.'),
      t.maj_le && t.maj_le !== t.cree_le ? el('li', null, 'Changée ', quand(date(t.maj_le)), '.') : null,
      t.statut === 'fait' && t.fait_le ? el('li', null, 'Faite ', quand(date(t.fait_le)), '.') : null));
    const zoneNotes = el('div', { class: 'bloc' });
    dessinerNotes = () => {
      const x = trouverTache(t.id);
      garderFocus(() => vider(zoneNotes, el('h3', { class: 'panneau__intertitre' }, 'Notes'),
        filNotes(x ? x.notes : [], t.id, { toujours: true, redessiner: () => dessinerNotes() })));
    };
    dessinerNotes();
    const actions = el('div', { class: 'actions' });
    const etatActions = { confirmer: '' };
    const confirmerIci = confirmations(etatActions, () => dessinerActions());
    const dessinerActions = () => vider(actions, t.statut === 'annule' ? null : confirmerIci('annuler', 'Annuler la tâche', 'Annuler cette tâche ?', async () => {
      await ecrire('tache', { id: t.id, statut: 'annule' });
      fermerPanneau(true);
      toast('Tâche annulée.');
    }));
    dessinerActions();
    apres.push(zoneNotes, actions);
  }
  panneauFormulaire({
    titre: t ? t.titre : 'Nouvelle tâche', sousTitre: t ? quiTache(t) : 'Pour toi, pour un associé ou pour tout le monde',
    avant, apres, edition: !!t, bouton: t ? 'Enregistrer' : 'Ajouter la tâche', chemin: 'tache',
    corps: [titre.boite, pour.boite, el('div', { class: 'deux' }, priorite.boite, echeance.boite), statut ? statut.boite : null, details.boite, lien.boite],
    preparer: () => {
      const v = valeurs();
      if (!v.titre) throw new Invalide('Écris la tâche, en une phrase courte.', titre.input);
      if (v.lien && !/^https:\/\/\S+$/.test(v.lien)) throw new Invalide('Le lien doit commencer par https:// (sans espace).', lien.input);
      if (!t) return { titre: v.titre, pour: v.pour, priorite: v.priorite, echeance: v.echeance, details: v.details, lien: v.lien, cle };
      const changes = { id: t.id };
      for (const k of Object.keys(v)) if (v[k] !== depart[k]) changes[k] = v[k];
      return changes;
    },
    reussite: () => {
      const v = valeurs();
      if (!t) return v.pour === m ? 'Tâche ajoutée.' : `Tâche ajoutée pour ${quiEst(v.pour)}.`;
      if (v.statut !== depart.statut) return { fait: 'Tâche faite.', en_cours: 'Tâche commencée.', a_faire: 'Tâche remise à faire.' }[v.statut];
      return 'Tâche enregistrée.';
    },
    modifie: () => JSON.stringify(valeurs()) !== JSON.stringify(depart),
    focus: () => (t ? $('#panneau-titre') : titre.input),
    rafraichir: () => dessinerNotes()
  });
}

// ─── Notes (sous une tâche ou un récap) ────────────────────────────────────
function filNotes(notes, cible, { toujours = false, redessiner }) {
  const confirmerNote = confirmations(ui, redessiner);
  const fil = notes.map(n => el('div', { class: 'note-fil' }, avatar(n.qui, n.nom),
    el('div', { class: 'note-fil__corps' },
      el('p', { class: 'note-fil__qui' }, el('b', null, Qui(n.qui, n.nom)), el('span', null, quand(date(n.quand)))),
      el('p', { class: 'note-fil__texte' }, n.texte),
      n.qui === moi() ? el('div', { class: 'note-fil__action' }, confirmerNote(`note-${n.id}`, 'Retirer', 'Retirer ta note ?', async () => {
        await ecrire('note/retirer', { id: n.id });
        toast('Note retirée.');
      }, { classe: 'lien lien--petit' })) : null)));
  const ouvert = toujours || ui.note === cible;
  return el('div', { class: 'notes' }, fil, ouvert ? formNote(cible, { toujours, redessiner }) : null);
}

function formNote(cible, { toujours, redessiner }) {
  const id = `note-${cible}`;
  const zone = el('textarea', { id, class: 'note-saisie', maxlength: 600, rows: 2, placeholder: 'Une réponse, une question, un bravo…',
    'data-focus': `saisie-${cible}`, enterkeyhint: 'enter' });
  zone.value = ui.brouillons.get(cible) || '';
  zone.addEventListener('input', () => { if (zone.value) ui.brouillons.set(cible, zone.value); else ui.brouillons.delete(cible); });
  const fermer = () => { ui.note = ''; ui.brouillons.delete(cible); ui.clesNotes.delete(cible); redessiner(); const r = document.querySelector(`[data-focus="rep-${CSS.escape(cible)}"]`); if (r) r.focus(); };
  const form = formulaireEnLigne({
    elements: [el('label', { class: 'sr', for: id }, 'Ta note'), zone],
    bouton: 'Envoyer',
    annuler: toujours ? null : fermer,
    classe: 'formulaire--note',
    envoyer: async () => {
      const texte = zone.value.trim();
      if (!texte) throw new Invalide('Écris ta note.', zone);
      if (!ui.clesNotes.has(cible)) ui.clesNotes.set(cible, nouvelleCle('rx'));
      await ecrire('note', { cible, texte, cle: ui.clesNotes.get(cible) });
      ui.brouillons.delete(cible); ui.clesNotes.delete(cible);
      if (!toujours) ui.note = '';
      redessiner();
      toast('Note ajoutée.');
    }
  });
  // ⌘ Entrée (ou Ctrl Entrée) envoie ; Échap ferme la note sous un récap
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    else if (e.key === 'Escape' && !toujours && !E.panneau) { e.preventDefault(); fermer(); }
  });
  return form;
}

// ─── Qui a fait quoi : les récaps ──────────────────────────────────────────
function rendreRecaps() {
  const boite = $('#equipe-recaps');
  if (!boite || attente(boite)) return;
  const liste = E.equipe.recaps;
  if (!liste.length) {
    return vider(boite, el('div', { class: 'vide vide--action' },
      el('p', null, 'Aucun récap pour l’instant. Après une grande session de travail, ton Claude écrit ici ce qui a avancé (branche-le avec la carte « Brancher mon Claude »). Tu peux aussi l’écrire toi-même.'),
      el('button', { class: 'btn btn--petit', type: 'button', onclick: () => ouvrirRecap() }, 'Écrire un récap')));
  }
  const montres = liste.slice(0, ui.recapsMontres);
  vider(boite, el('div', { class: 'recaps' }, montres.map(carteRecap)),
    liste.length > montres.length ? el('button', { class: 'btn btn--contour btn--petit debut', type: 'button',
      onclick: () => { ui.recapsMontres += 10; rendreEquipe(); } }, `Voir ${Math.min(10, liste.length - montres.length)} de plus`) : null);
}

function redessinerRecap(id) {
  const r = E.equipe && E.equipe.recaps.find(x => x.id === id);
  const n = document.getElementById(`recap-${id}`);
  if (r && n) garderFocus(() => n.replaceWith(carteRecap(r)));
}

function lienPuce(u) {
  return el('a', { class: 'puce puce--lien', href: urlSure(u), target: '_blank', rel: 'noopener noreferrer' }, icone('i-sortie'), el('span', null, hote(u)));
}

function carteRecap(r) {
  const fin = date(r.fin) || date(r.cree_le);
  const mien = r.qui === moi();
  const meta = [fin ? quand(fin) : '', r.minutes ? `${dureeHM(r.minutes)} de travail` : '', r.source === 'claude' ? 'par Claude' : r.source === 'collage' ? 'collé de Claude' : '']
    .filter(Boolean).join(' · ');
  return el('article', { class: `recap${mien ? ' recap--mien' : ''}`, id: `recap-${r.id}`, 'aria-labelledby': `recap-t-${r.id}` },
    el('div', { class: 'recap__tete' }, avatar(r.qui, r.nom),
      el('p', { class: 'recap__qui' }, el('b', null, Qui(r.qui, r.nom)), el('span', null, meta)),
      mien ? el('div', { class: 'recap__action' }, confirmer(`retirer-${r.id}`, 'Retirer', 'Retirer ce récap ?', async () => {
        await ecrire('recap/retirer', { id: r.id });
        toast('Récap retiré : ses heures ne comptent plus.');
      }, { classe: 'lien lien--petit' })) : null),
    el('h3', { class: 'recap__titre', id: `recap-t-${r.id}` }, r.titre),
    el('ul', { class: 'recap__fait', 'aria-label': 'Fait' }, r.fait.map(x => el('li', null, x))),
    r.reste.length ? el('div', { class: 'recap__reste' }, el('p', { class: 'petit-titre' }, 'Reste à faire'),
      el('ul', null, r.reste.map(x => el('li', null, x)))) : null,
    r.liens.length ? el('div', { class: 'recap__liens' }, r.liens.map(lienPuce)) : null,
    barreReactions(r),
    r.notes.length || ui.note === r.id ? filNotes(r.notes, r.id, { redessiner: () => redessinerRecap(r.id) }) : null);
}

function barreReactions(r) {
  const emojis = E.equipe.regles.emojis;
  const boutons = r.reactions.map(x => {
    const avecMoi = x.qui.includes(moi());
    const noms = x.qui.map((q, i) => quiEst(q, x.noms[i]));
    const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0];
    return el('button', { class: `reaction${avecMoi ? ' reaction--moi' : ''}`, type: 'button', 'aria-pressed': String(avecMoi),
      'aria-label': `${x.valeur} : ${liste}`, title: majuscule(liste), 'data-focus': `rx-${r.id}-${x.valeur}`, onclick: () => reagir(r.id, x.valeur) },
    el('span', { class: 'reaction__emoji', 'aria-hidden': 'true' }, x.valeur), el('span', { class: 'reaction__n', 'aria-hidden': 'true' }, String(x.qui.length)));
  });
  const ouvert = ui.emoji === r.id;
  const plus = el('button', { class: 'reaction reaction--ajout', type: 'button', 'aria-expanded': String(ouvert), 'aria-label': 'Réagir avec un emoji',
    title: 'Réagir', 'data-focus': `plus-${r.id}`, onclick: () => {
      ui.emoji = ouvert ? '' : r.id;
      redessinerRecap(r.id);
      if (!ouvert) { const p = document.querySelector(`#recap-${CSS.escape(r.id)} .emojis button`); if (p) p.focus(); }
    } }, icone('i-sourire'));
  const choix = ouvert ? el('div', { class: 'emojis', role: 'group', 'aria-label': 'Choisis une réaction' },
    emojis.map(e => el('button', { class: 'emojis__un', type: 'button', 'aria-label': e, onclick: () => { ui.emoji = ''; reagir(r.id, e, `plus-${r.id}`); } }, e))) : null;
  if (choix) {
    choix.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); ui.emoji = ''; redessinerRecap(r.id); const p = document.querySelector(`[data-focus="plus-${CSS.escape(r.id)}"]`); if (p) p.focus(); }
      const tous = [...choix.querySelectorAll('button')], i = tous.indexOf(document.activeElement);
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && i >= 0) { e.preventDefault(); tous[(i + (e.key === 'ArrowRight' ? 1 : tous.length - 1)) % tous.length].focus(); }
    });
  }
  const repondre = el('button', { class: 'lien lien--petit recap__repondre', type: 'button', 'data-focus': `rep-${r.id}`,
    'aria-expanded': String(ui.note === r.id), onclick: () => {
      ui.note = ui.note === r.id ? '' : r.id;
      redessinerRecap(r.id);
      const z = document.querySelector(`[data-focus="saisie-${CSS.escape(r.id)}"]`);
      if (z) z.focus();
    } }, icone('i-note'), 'Répondre');
  return el('div', { class: 'recap__reactions' }, boutons, plus, repondre, choix);
}
document.addEventListener('pointerdown', e => {
  if (ui.emoji && !e.target.closest('.recap__reactions')) { const id = ui.emoji; ui.emoji = ''; redessinerRecap(id); }
}, { passive: true });

// Une réaction : l'écran change tout de suite, le serveur confirme ensuite
async function reagir(id, emoji, focus = '') {
  const r = E.equipe && E.equipe.recaps.find(x => x.id === id);
  if (!r) return;
  const avant = JSON.stringify(r.reactions);
  const x = r.reactions.find(y => y.valeur === emoji);
  if (x && x.qui.includes(moi())) {
    const i = x.qui.indexOf(moi());
    x.qui.splice(i, 1); x.noms.splice(i, 1);
    if (!x.qui.length) r.reactions.splice(r.reactions.indexOf(x), 1);
  } else if (x) { x.qui.push(moi()); x.noms.push(monPrenom()); }
  else {
    const ordre = E.equipe.regles.emojis;
    r.reactions.push({ valeur: emoji, qui: [moi()], noms: [monPrenom()] });
    r.reactions.sort((a, b) => ordre.indexOf(a.valeur) - ordre.indexOf(b.valeur));
  }
  redessinerRecap(id);
  const cible = document.querySelector(`[data-focus="${CSS.escape(focus || `rx-${id}-${emoji}`)}"]`) || document.querySelector(`[data-focus="plus-${CSS.escape(id)}"]`);
  if (cible && !cible.contains(document.activeElement)) cible.focus({ preventScroll: true });
  try { await ecrire('reaction', { cible: id, emoji }); }
  catch (e) {
    const s = E.equipe && E.equipe.recaps.find(y => y.id === id);
    if (s) { s.reactions = JSON.parse(avant); redessinerRecap(id); }
    if (e.statut !== 401) toast(e.message || 'La réaction n’est pas passée. Réessaie.', true);
  }
}

// ─── Panneau : écrire un récap soi-même ────────────────────────────────────
export function ouvrirRecap() {
  if (!pret()) return;
  const cle = nouvelleCle('re');
  const maintenant = versLocal(new Date());
  const titre = champTexte('Titre', { maxlength: 140, autocomplete: 'off', placeholder: 'Ex. : Onglet Argent terminé' }, 'Ce qui a avancé, en quelques mots.');
  const fait = champTexte('Fait', { multiligne: true, rows: 5, maxlength: 3000, placeholder: 'Un point par ligne' }, 'Un point par ligne, 12 au plus : ce qui a changé pour l’agence.');
  const reste = champTexte('Reste à faire', { multiligne: true, rows: 3, maxlength: 3000, placeholder: 'Un point par ligne' }, '', 'facultatif');
  const liens = champTexte('Liens', { multiligne: true, rows: 2, maxlength: 4000, spellcheck: 'false', autocapitalize: 'none', placeholder: 'https://…' },
    'Un lien par ligne : un document, une demande de fusion…', 'facultatif');
  const debut = champTexte('Début', { type: 'datetime-local', max: maintenant }, '', 'facultatif');
  const fin = champTexte('Fin', { type: 'datetime-local', max: maintenant }, '', 'facultatif');
  const valeurs = () => [titre, fait, reste, liens, debut, fin].map(c => c.input.value).join('|');
  const depart = valeurs();
  panneauFormulaire({
    titre: 'Écrire un récap', sousTitre: 'Ce qui a avancé pendant ta session de travail',
    corps: [titre.boite, fait.boite, reste.boite, liens.boite, el('div', { class: 'deux' }, debut.boite, fin.boite),
      el('p', { class: 'note' }, 'Avec le début et la fin, la session compte dans tes heures, sans compter deux fois ton chrono. Heure du Québec.')],
    bouton: 'Publier le récap', chemin: 'recap',
    preparer: () => {
      const t = titre.input.value.trim(), f = lignesDe(fait.input.value), l = lignesDe(liens.input.value);
      if (!t) throw new Invalide('Donne un titre au récap.', titre.input);
      if (!f.length) throw new Invalide('Écris au moins un point dans « Fait ».', fait.input);
      if (f.length > 12) throw new Invalide('12 points au plus dans « Fait » : regroupe les plus petits.', fait.input);
      const mauvais = l.find(x => !/^https:\/\/\S+$/.test(x));
      if (mauvais) throw new Invalide(`Ce lien doit commencer par https:// : ${mauvais.slice(0, 60)}`, liens.input);
      const d = debut.input.value, n = fin.input.value;
      if (!!d !== !!n) throw new Invalide('Écris le début et la fin, ou aucun des deux.', d ? fin.input : debut.input);
      if (d && n <= d) throw new Invalide('La fin doit venir après le début.', fin.input);
      return { titre: t, fait: f, reste: lignesDe(reste.input.value), liens: l, debut: d, fin: n, cle };
    },
    reussite: 'Récap publié.',
    modifie: () => valeurs() !== depart,
    focus: () => titre.input
  });
}

// ─── Heures ────────────────────────────────────────────────────────────────
function rendreHeures() {
  const boite = $('#equipe-heures');
  if (!boite || attente(boite)) return;
  const h = E.equipe.heures.personnes;
  if (!h.length) return vider(boite, el('p', { class: 'vide' }, 'Personne pour l’instant.'));
  // Une même échelle pour tout le monde : les barres se comparent d'un coup d'œil
  const max = Math.max(60, ...h.flatMap(p => p.par_jour.map(j => j.minutes)));
  vider(boite, el('div', { class: 'heures' }, h.map(p => blocHeures(p, max))),
    el('p', { class: 'note' }, 'Le chrono de l’app et les sessions des récaps, réunis : un même moment ne compte jamais deux fois. La semaine commence le lundi.'));
}

function auTravail(enCours) {
  const min = (Date.now() - Date.parse(enCours.debut)) / 60000;
  if (enCours.trop_long) return `Chrono oublié ? Plus de ${E.equipe.regles.session_max_h} h`;
  return min < 1 ? 'Vient de commencer' : `Au travail depuis ${dureeHM(min)}`;
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function blocHeures(p, max) {
  const enCours = p.en_cours;
  const mois = Number(aujourdhui().slice(5, 7)) - 1;
  return el('section', { class: 'heures__personne', 'aria-label': `Heures de ${quiEst(p.identifiant, p.nom)}` },
    el('div', { class: 'heures__haut' }, avatar(p.identifiant, p.nom), el('b', null, Qui(p.identifiant, p.nom)),
      enCours ? el('span', { class: 'en-direct' }, el('i', { 'aria-hidden': 'true' }), auTravail(enCours)) : null),
    el('p', { class: 'heures__chiffre' }, el('b', null, dureeHM(p.semaine)), el('span', null, 'cette semaine')),
    el('p', { class: 'heures__detail' }, `Semaine dernière : ${dureeHM(p.semaine_precedente)} · ${majuscule(MOIS[mois])} : ${dureeHM(p.mois)} · ${majuscule(MOIS[(mois + 11) % 12])} : ${dureeHM(p.mois_precedent)}`),
    barres(p, max));
}

// 14 jours en petites barres ; survoler ou toucher une barre dit le jour sous le graphique
function barres(p, max) {
  const jours = p.par_jour;
  const legende = el('p', { class: 'barres__legende' });
  const elements = jours.map((j, i) => el('span', {
    class: `barres__barre${j.minutes ? '' : ' zero'}${i === jours.length - 1 ? ' auj' : ''}`,
    style: `height: ${j.minutes ? Math.max(6, Math.round(j.minutes / max * 100)) : 0}%`
  }));
  const montrerJour = (i, survol = true) => {
    elements.forEach((b, k) => b.classList.toggle('actif', survol && k === i));
    const j = jours[i];
    vider(legende, el('b', null, majuscule(nomDuJour(j.jour))), ` : ${j.minutes ? dureeHM(j.minutes) : 'rien'}`);
  };
  const resume = jours.filter(j => j.minutes).map(j => `${nomDuJour(j.jour)} ${dureeHM(j.minutes)}`).join(', ');
  const zone = el('div', { class: 'barres', role: 'img', 'aria-label': `Les 14 derniers jours : ${resume || 'rien encore'}.` }, elements);
  const indice = e => { const r = zone.getBoundingClientRect(); return Math.min(jours.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * jours.length))); };
  zone.addEventListener('pointermove', e => montrerJour(indice(e)));
  zone.addEventListener('pointerdown', e => montrerJour(indice(e)));
  zone.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') montrerJour(jours.length - 1, false); });
  montrerJour(jours.length - 1, false);
  return el('div', { class: 'barres-bloc' }, zone,
    el('div', { class: 'barres__axe', 'aria-hidden': 'true' }, el('span', null, jourCourt(jours[0].jour)), el('span', null, 'auj.')), legende);
}

// ─── Panneau : mes heures (ajouter une session oubliée, corriger, retirer) ─
export function ouvrirHeures() {
  if (!pret()) return;
  const etat = { sale: false, edition: '', confirmer: '' };
  etat.modifie = () => etat.sale;
  const corps = el('div', { class: 'heures-panneau' });
  const confirmerIci = confirmations(etat, () => dessiner());
  // une clé par session ajoutée : renvoyée deux fois (réseau), elle ne compte qu'une fois
  let cle = nouvelleCle('he');
  const SOURCES = { chrono: 'Chrono', manuel: 'Ajoutée', claude: 'Récap' };

  function formulaire(s) {
    const maintenant = new Date();
    const d0 = s ? versLocal(new Date(s.debut)) : versLocal(arrondi5(maintenant.getTime() - 3600e3));
    const f0 = s ? (s.fin ? versLocal(new Date(s.fin)) : '') : versLocal(arrondi5(maintenant.getTime()));
    const d = champTexte('Début', { type: 'datetime-local', value: d0, max: versLocal(maintenant) });
    const f = champTexte('Fin', { type: 'datetime-local', value: f0 || null, max: versLocal(maintenant) }, s && !s.fin ? 'Vide : la session continue.' : '');
    const note = champTexte('Sur quoi', { maxlength: 140, autocomplete: 'off', value: s ? s.note || null : null, placeholder: 'Ex. : appels de prospection' }, '', 'facultatif');
    return formulaireEnLigne({
      elements: [el('div', { class: 'deux' }, d.boite, f.boite), note.boite], bouton: s ? 'Enregistrer' : 'Ajouter la session',
      annuler: () => { etat.edition = ''; etat.sale = false; dessiner(); },
      envoyer: async () => {
        if (!d.input.value) throw new Invalide('Choisis le début.', d.input);
        if ((!s || s.fin) && !f.input.value) throw new Invalide('Choisis la fin.', f.input);
        if (f.input.value && f.input.value <= d.input.value) throw new Invalide('La fin doit venir après le début.', f.input);
        await ecrire('heures', { ...(s ? { id: s.id } : { cle }), debut: d.input.value, fin: f.input.value, note: note.input.value.trim() });
        if (!s) cle = nouvelleCle('he');
        etat.edition = ''; etat.sale = false;
        dessiner();
        toast(s ? 'Session corrigée.' : 'Session ajoutée à tes heures.');
      }
    });
  }

  function ligne(s) {
    const d = new Date(s.debut), f = s.fin ? new Date(s.fin) : null;
    const plage = `${jourHeure(d)} · ${heure(d)} → ${f ? heure(f) : 'en cours'}`;
    if (etat.edition === s.id) return el('li', { class: 'session session--edition' }, el('p', { class: 'session__titre' }, plage), formulaire(s));
    return el('li', { class: 'session' },
      el('div', { class: 'session__texte' },
        el('p', { class: 'session__titre' }, plage),
        el('p', { class: 'session__meta' }, [dureeHM(s.minutes), SOURCES[s.source] || s.source, s.note].filter(Boolean).join(' · '))),
      s.modifiable
        ? el('div', { class: 'session__actions' },
          el('button', { class: 'lien lien--petit', type: 'button', 'data-focus': `modif-${s.id}`, onclick: () => { etat.edition = s.id; dessiner(); const i = corps.querySelector('.session--edition input'); if (i) i.focus(); } }, 'Modifier'),
          confirmerIci(`session-${s.id}`, 'Retirer', 'Retirer cette session ?', async () => { await ecrire('heures', { id: s.id, retirer: true }); toast('Session retirée.'); }, { classe: 'lien lien--petit' }))
        : el('p', { class: 'session__meta session__note' }, 'Pour l’enlever : retire son récap.'));
  }

  function dessiner() {
    const sessions = (E.equipe ? E.equipe.heures.sessions : []).filter(s => s.qui === moi());
    garderFocus(() => vider(corps,
      el('div', { class: 'bloc' },
        etat.edition === 'nouvelle'
          ? [el('h3', null, 'Une session oubliée'), formulaire(null)]
          : el('button', { class: 'btn btn--contour btn--petit debut', type: 'button', 'data-focus': 'ajouter-session', onclick: () => {
            etat.edition = 'nouvelle'; dessiner();
            const i = corps.querySelector('input'); if (i) i.focus();
          } }, icone('i-plus'), 'Ajouter une session oubliée')),
      el('div', { class: 'bloc' }, el('h3', { class: 'panneau__intertitre' }, 'Mes dernières sessions'),
        sessions.length ? el('ul', { class: 'sessions' }, sessions.map(ligne)) : el('p', { class: 'vide' }, 'Aucune session pour l’instant : touche « Je commence » quand tu te mets au travail.')),
      el('p', { class: 'note' }, `Une session de plus de ${E.equipe ? E.equipe.regles.session_max_h : 12} h compte ${E.equipe ? E.equipe.regles.session_max_h : 12} h au plus : c’est un chrono oublié. Chacun corrige ses propres heures.`)));
  }
  etat.rafraichir = () => { if (!etat.sale) dessiner(); };
  etat.focus = () => corps.querySelector('button');
  corps.addEventListener('input', () => { etat.sale = true; });
  ouvrirPanneau(etat, 'Mes heures', 'Le chrono, les sessions ajoutées et celles des récaps', [corps],
    [el('button', { class: 'btn btn--discret ml-auto', type: 'button', onclick: () => fermerPanneau() }, 'Fermer')]);
  dessiner();
}

// ─── Documents ─────────────────────────────────────────────────────────────
function rendreDocuments() {
  const boite = $('#equipe-documents');
  if (!boite || attente(boite)) return;
  const docs = E.equipe.documents;
  if (!docs.length) {
    return vider(boite, el('div', { class: 'vide vide--action' },
      el('p', null, 'Garde ici les liens importants : le dossier Drive de l’agence, le contrat d’associés, le tableau des dépenses…'),
      el('button', { class: 'btn btn--petit', type: 'button', onclick: () => ouvrirDocument() }, 'Ajouter un lien')));
  }
  vider(boite, el('ul', { class: 'documents' }, docs.map(d => el('li', { class: 'document' },
    el('a', { class: 'document__lien', href: urlSure(d.lien), target: '_blank', rel: 'noopener noreferrer' },
      el('span', { class: 'document__icone', 'aria-hidden': 'true' }, icone('i-document')),
      el('span', { class: 'document__texte' }, el('b', null, d.titre), el('span', null, d.note || hote(d.lien)))),
    el('button', { class: 'mini', type: 'button', 'aria-label': `Modifier « ${d.titre} »`, title: 'Modifier', 'data-focus': `doc-${d.id}`,
      onclick: () => ouvrirDocument(d.id) }, icone('i-crayon'))))));
}

export function ouvrirDocument(id = '') {
  if (!pret()) return;
  const d = id ? E.equipe.documents.find(x => x.id === id) : null;
  if (id && !d) return toast('Ce document n’existe plus.', true);
  const cle = nouvelleCle('do');
  const titre = champTexte('Nom', { maxlength: 100, autocomplete: 'off', placeholder: 'Ex. : Dossier Drive de l’agence', value: d ? d.titre : null });
  const lien = champTexte('Lien', { type: 'url', inputmode: 'url', maxlength: 500, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none',
    placeholder: 'https://…', value: d ? d.lien : null });
  const note = champTexte('Note', { maxlength: 200, autocomplete: 'off', placeholder: 'Ex. : contrats, factures et logos', value: d ? d.note || null : null }, '', 'facultatif');
  const valeurs = () => [titre, lien, note].map(c => c.input.value.trim()).join('|');
  const depart = valeurs();
  const apres = [];
  if (d) {
    const actions = el('div', { class: 'actions' });
    const etatActions = { confirmer: '' };
    const confirmerIci = confirmations(etatActions, () => dessiner());
    const dessiner = () => vider(actions, confirmerIci('retirer', 'Retirer ce document', 'Retirer ce lien de la liste ?', async () => {
      await ecrire('document', { id: d.id, retirer: true });
      fermerPanneau(true);
      toast('Document retiré de la liste.');
    }));
    dessiner();
    apres.push(el('p', { class: 'note' }, `Ajouté ${quand(date(d.cree_le))} par ${quiEst(d.cree_par, d.cree_nom)}.`), actions);
  }
  panneauFormulaire({
    titre: d ? d.titre : 'Nouveau document', sousTitre: 'Un lien que toute l’équipe retrouve ici', edition: !!d, apres,
    corps: [titre.boite, lien.boite, note.boite], bouton: d ? 'Enregistrer' : 'Ajouter', chemin: 'document',
    preparer: () => {
      const t = titre.input.value.trim(), l = lien.input.value.trim();
      if (!t) throw new Invalide('Donne un nom au document.', titre.input);
      if (!/^https:\/\/\S+$/.test(l)) throw new Invalide('Colle le lien du document : il commence par https://', lien.input);
      return { ...(d ? { id: d.id } : { cle }), titre: t, lien: l, note: note.input.value.trim() };
    },
    reussite: d ? 'Document enregistré.' : 'Document ajouté.',
    modifie: () => valeurs() !== depart,
    focus: () => (d ? $('#panneau-titre') : titre.input)
  });
}

// ─── Brancher mon Claude ───────────────────────────────────────────────────
function rendreClaude() {
  const boite = $('#equipe-claude');
  if (!boite || attente(boite)) return;
  const q = E.equipe;
  const miennes = q.cles.filter(k => k.qui === moi()).length;
  const code = t => el('code', null, t);
  vider(boite,
    el('p', { class: 'claude__intro' }, 'Ton Claude lit tes tâches, en donne aux autres et écrit le récap de ta session. Sa clé ne sert qu’aux tâches et aux récaps : jamais à l’argent, aux clients ni aux comptes.'),
    el('ol', { class: 'etapes-installer' },
      el('li', null, el('span', null, el('b', null, 'Crée une clé'), ' pour ton Claude (une par Claude).')),
      el('li', null, el('span', null, 'Mets-la dans la variable ', code('UIO_CLE_CLAUDE'), ' de son environnement : jamais dans un message, un fichier ni sa mémoire.')),
      el('li', null, el('span', null, el('b', null, 'Copie le mode d’emploi'), ' et colle-le dans les instructions de ton Claude.'))),
    el('div', { class: 'carte__pied' },
      el('button', { class: 'btn btn--petit', type: 'button', disabled: miennes >= q.regles.cles_max, onclick: () => ouvrirCle() }, icone('i-cle'), 'Créer une clé'),
      el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: copierModeEmploi }, icone('i-copier'), 'Copier le mode d’emploi')),
    miennes >= q.regles.cles_max ? el('p', { class: 'note' }, `Tu as déjà ${q.regles.cles_max} clés : retire celle d’un Claude que tu n’utilises plus.`) : null,
    depliant('Lire le mode d’emploi', el('pre', { class: 'mode-emploi' }, modeEmploi())),
    el('p', { class: 'note' }, 'Sans clé ou sans réseau, ton Claude écrit un bloc « RÉCAP UIO » ou « TÂCHE UIO » : colle-le avec « Coller de Claude ».'),
    q.cles.length ? el('div', { class: 'rangees cles-claude' }, q.cles.map(k => rangee({
      icon: 'i-cle', titre: k.nom,
      badges: [k.qui === moi() ? badge('À toi') : badge(`À ${prenom(k.nom_personne) || k.qui}`, 'neutre')],
      meta: [`${k.apercu} · créée ${quand(date(k.cree_le))}`, k.utilisee_le ? `Utilisée ${quand(date(k.utilisee_le))}` : 'Pas encore utilisée'],
      action: confirmer(`cle-${k.id}`, 'Retirer', k.qui === moi() ? 'Retirer cette clé ?' : `Retirer la clé de ${prenom(k.nom_personne) || k.qui} ?`, async () => {
        await ecrire('cle/retirer', { id: k.id });
        toast('Clé retirée : ce Claude n’a plus accès.');
      })
    }))) : null);
}

async function copierModeEmploi() {
  if (!pret()) return;
  toast(await copier(modeEmploi()) ? 'Mode d’emploi copié : colle-le dans les instructions de ton Claude.' : 'La copie n’a pas marché : ouvre « Lire le mode d’emploi » et copie-le à la main.', false);
}

// Le mode d'emploi pour Claude : l'API (avec la clé) et, sans réseau, les blocs à coller
export function modeEmploi() {
  const q = E.equipe;
  const nom = monPrenom() || 'ton associé';
  const lesAutres = autres().map(p => prenom(p.nom) || p.identifiant);
  const autre = lesAutres[0] || 'l’autre associé';
  const avec = lesAutres.length ? ` avec ${lesAutres.length > 1 ? `${lesAutres.slice(0, -1).join(', ')} et ${lesAutres[lesAutres.length - 1]}` : autre}` : '';
  const B = BACKEND;
  const max = q ? q.regles.session_max_h : 12;
  const entete = '-H "Authorization: Bearer $UIO_CLE_CLAUDE"';
  const poste = (route, json) => `curl -sS -X POST ${B}${route} ${entete} \\\n  -H "Content-Type: application/json" --data-binary @- <<'JSON'\n${json}\nJSON`;
  return [
    `# Agence UIO : tâches et récaps de l’équipe`,
    ``,
    `Tu es le Claude de ${nom}, associé d’Agence UIO${avec}. L’onglet Équipe de l’admin (agenceuio.ca/admin/) garde les tâches entre associés et les récaps « Qui a fait quoi ». Ta clé est dans la variable d’environnement UIO_CLE_CLAUDE.`,
    ``,
    `## Règles`,
    `- Ne montre, n’écris et ne mémorise jamais la clé (ni dans un fichier, ni dans un message, ni dans un commit, ni dans ta mémoire). Sers-toi seulement de $UIO_CLE_CLAUDE.`,
    `- La clé ne sert qu’aux tâches et aux récaps : rien sur l’argent, les clients ni les comptes.`,
    `- Les heures sont en heure du Québec, écrites comme 2026-11-08 20:10.`,
    `- Le serveur dort quand personne ne s’en sert : la première requête peut prendre une minute.`,
    `- Si une requête est refusée (réseau bloqué, clé absente), passe aux blocs à coller (plus bas) : ne cherche pas d’autre chemin.`,
    ``,
    `## Au début d’une session`,
    `curl -sS ${B}/portal/claude/taches ${entete}`,
    `Dis à ${nom} ce qui l’attend (« pour_toi ») : les urgentes et celles en retard d’abord.`,
    ``,
    `## Donner une tâche à ${autre}`,
    poste('/portal/claude/tache', `{"pour": "${autre}", "titre": "…", "details": "…", "priorite": "normale", "echeance": "2026-11-12"}`),
    `- pour : un prénom, « moi » ou « tous ». priorite : normale ou urgente. echeance, details et lien (https://…) sont facultatifs.`,
    `- Une tâche pour quelqu’un d’autre envoie aussi un courriel à la boîte de l’agence.`,
    ``,
    `## Quand une tâche avance`,
    poste('/portal/claude/tache/statut', `{"id": "ta_…", "statut": "fait"}`),
    `- statut : en_cours, fait, a_faire ou annule (seulement les tâches pour ${nom}, de ${nom}, ou pour tous).`,
    ``,
    `## À la fin d’une grande session de travail : le récap`,
    `Écris un récap court : un titre ; de 3 à 8 points « fait » (ce qui a changé pour l’agence, pas le détail technique) ; ce qui reste ; les liens utiles (demande de fusion, document) ; le début et la fin de la session.`,
    poste('/portal/claude/recap', `{"titre": "…", "fait": ["…", "…"], "reste": ["…"], "liens": ["https://…"], "debut": "2026-11-08 20:10", "fin": "2026-11-08 22:40"}`),
    `- La session compte dans les heures de ${nom}, sans compter deux fois son chrono. ${max} h au plus par récap, et pas dans le futur.`,
    `- Pour ne jamais l’envoyer deux fois, ajoute "cle": "re_" suivi de 16 lettres ou chiffres au hasard (la même clé n’ajoute rien de plus).`,
    ``,
    `## Lire les derniers récaps de l’équipe`,
    `curl -sS "${B}/portal/claude/recaps?n=10" ${entete}`,
    ``,
    `## Sans réseau ou sans clé : un bloc à coller`,
    `Écris le bloc tel quel ; ${nom} le colle dans l’admin (onglet Équipe, « Coller de Claude »). Un même bloc collé deux fois ne compte qu’une fois.`,
    ``,
    `RÉCAP UIO`,
    `Titre : …`,
    `Début : 2026-11-08 20:10`,
    `Fin : 2026-11-08 22:40`,
    `Fait :`,
    `- …`,
    `Reste :`,
    `- …`,
    `Liens :`,
    `- https://…`,
    ``,
    `TÂCHE UIO`,
    `Pour : ${autre}`,
    `Titre : …`,
    `Priorité : normale`,
    `Échéance : 2026-11-12`,
    `Détails : …`,
    ``,
    `(Le serveur : ${DOMAINE}.)`
  ].join('\n');
}

// ─── Panneau : créer une clé pour un Claude (montrée une seule fois) ───────
export function ouvrirCle() {
  if (!pret()) return;
  const corps = el('div', { class: 'formulaire' });
  // La clé ne reste pas dans la page une fois le panneau fermé
  const etat = { modifie: () => false, fermer: () => { for (const s of corps.querySelectorAll('.secret--cle')) s.textContent = ''; } };
  const nom = champTexte('Nom de ce Claude', { maxlength: 60, autocomplete: 'off', placeholder: 'Ex. : Claude Code sur mon Mac' },
    'Pour le reconnaître dans la liste et dans le journal.');
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const form = el('form', { class: 'formulaire', id: 'form-cle', novalidate: true },
    el('p', { class: 'info' }, el('span', null, el('b', null, 'Une clé par Claude. '), 'Elle ne sert qu’aux tâches et aux récaps de l’équipe, jamais à l’argent, aux clients ni aux comptes. Elle se retire en un geste.')),
    nom.boite, erreur);
  const creer = el('button', { class: 'btn', type: 'submit', form: 'form-cle' }, 'Créer la clé');
  let envoi = false;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (envoi) return;
    envoi = true;
    erreur.textContent = '';
    creer.disabled = true;
    try {
      const r = await ecrire('cle', { nom: nom.input.value.trim() || 'Mon Claude' });
      montrerCle(r.cle, nom.input.value.trim() || 'Mon Claude');
    } catch (e) {
      envoi = false;
      creer.disabled = false;
      if (e.statut !== 401) erreur.textContent = fr(e.message);
    }
  });
  vider(corps, form);
  etat.focus = () => nom.input;
  etat.enregistrer = () => form.requestSubmit();
  ouvrirPanneau(etat, 'Brancher mon Claude', 'Une clé pour un Claude, montrée une seule fois', [corps],
    [el('button', { class: 'btn btn--discret ml-auto', type: 'button', onclick: () => fermerPanneau() }, 'Annuler'), creer]);

  function montrerCle(cle, nomClaude) {
    const boite = el('p', { class: 'secret secret--cle', tabindex: '0', 'aria-label': 'La clé' }, cle);
    const copierCle = el('button', { class: 'btn btn--petit', type: 'button', onclick: async () => {
      if (await copier(cle)) { copierCle.replaceChildren(icone('i-ok'), fr('Clé copiée')); toast('Clé copiée.'); }
      else toast('La copie n’a pas marché : touche la clé et copie-la à la main.', true);
    } }, icone('i-copier'), 'Copier la clé');
    vider(corps,
      el('div', { class: 'grand-icone grand-icone--ok', 'aria-hidden': 'true' }, icone('i-cle')),
      el('h3', { class: 'cle__titre', tabindex: '-1' }, `La clé de « ${nomClaude} » est prête`),
      el('p', { class: 'info info--attention' }, el('span', null, el('b', null, 'Copie-la maintenant : '), 'elle ne s’affichera plus jamais. Ne la colle jamais dans un message, un fichier ou la mémoire de Claude.')),
      boite,
      el('div', { class: 'carte__pied' }, copierCle,
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: copierModeEmploi }, icone('i-copier'), 'Copier le mode d’emploi')),
      el('ol', { class: 'etapes-installer' },
        el('li', null, el('span', null, 'Mets la clé dans une variable secrète nommée ', el('code', null, 'UIO_CLE_CLAUDE'), ' dans les réglages de l’environnement de ton Claude (sur ton ordinateur : ', el('code', null, 'export UIO_CLE_CLAUDE=…'), ' dans ton terminal).')),
        el('li', null, el('span', null, 'Son réseau doit permettre ', el('code', null, DOMAINE), '. Sinon, il écrit ses récaps en blocs à coller.')),
        el('li', null, el('span', null, 'Colle le mode d’emploi dans ses instructions (le fichier CLAUDE.md, ou les instructions du projet).'))),
      el('p', { class: 'note' }, 'Perdue ? Retire-la dans la liste et crée-en une autre. Un courriel prévient la boîte de l’agence à chaque nouvelle clé.'));
    vider($('#panneau-pied'), el('button', { class: 'btn ml-auto', type: 'button', onclick: () => fermerPanneau(true) }, 'C’est fait'));
    const h = corps.querySelector('.cle__titre');
    if (h) h.focus();
  }
}

// ─── Panneau : coller de Claude ────────────────────────────────────────────
export function ouvrirCollage() {
  if (!pret()) return;
  const texte = champTexte('Le texte de ton Claude', { multiligne: true, rows: 10, maxlength: 20000, spellcheck: 'false', autocapitalize: 'none',
    autocorrect: 'off', class: 'champ--code', placeholder: 'RÉCAP UIO\nTitre : …\nFait :\n- …' },
  'Un ou plusieurs blocs « RÉCAP UIO » ou « TÂCHE UIO ». Un bloc déjà collé n’est jamais ajouté deux fois.');
  const apercu = el('div', { class: 'collage', 'aria-live': 'polite' });
  let resultat = null, minuterie = 0, numero = 0;
  const verifier = async () => {
    const t = texte.input.value.trim();
    resultat = null;
    const n = ++numero;
    if (!t) return vider(apercu);
    vider(apercu, el('p', { class: 'note' }, 'Lecture du texte…'));
    try {
      const r = await api('/portal/admin/equipe/coller', { methode: 'POST', corps: { texte: t, verifier: true }, delai: 30000 });
      if (n !== numero) return;
      resultat = r.blocs || [];
      vider(apercu, el('p', { class: 'petit-titre' }, 'Ce qui sera ajouté'), el('ul', { class: 'collage__liste' }, resultat.map(apercuBloc)));
    } catch (e) {
      if (n !== numero || e.statut === 401) return;
      vider(apercu, el('p', { class: 'erreur' }, fr(e.message)));
    }
  };
  texte.input.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(verifier, 450); });
  panneauFormulaire({
    titre: 'Coller de Claude', sousTitre: 'Un récap ou une tâche que ton Claude a écrit',
    corps: [texte.boite, apercu], bouton: 'Ajouter', chemin: 'coller',
    preparer: () => {
      const t = texte.input.value.trim();
      if (!t) throw new Invalide('Colle d’abord le texte de ton Claude.', texte.input);
      if (resultat && resultat.length && resultat.every(b => b.deja)) throw new Invalide('Rien de nouveau : tout est déjà dans l’admin.', texte.input);
      return { texte: t };
    },
    reussite: r => (r.ajoutes ? `${pluriel(r.ajoutes, 'ajout', 'ajouts')} dans l’équipe.` : 'Rien de nouveau : tout était déjà là.'),
    modifie: () => !!texte.input.value.trim(),
    focus: () => texte.input
  });
}

function apercuBloc(b) {
  const etat = b.deja ? badge('Déjà ajouté', 'neutre') : badge('Nouveau');
  if (b.sorte === 'tache') {
    const plus = [b.priorite === 'urgente' ? 'urgente' : '', b.echeance ? pourQuand(b.echeance) : ''].filter(Boolean).join(', ');
    return el('li', { class: 'collage__bloc' }, el('span', { class: 'collage__quoi' }, `Tâche pour ${quiEst(b.pour, b.pour_nom)}`), etat,
      el('b', null, b.titre), plus ? el('span', { class: 'note' }, majuscule(plus)) : null);
  }
  return el('li', { class: 'collage__bloc' }, el('span', { class: 'collage__quoi' }, 'Récap'), etat, el('b', null, b.titre),
    el('span', { class: 'note' }, [pluriel(b.fait.length, 'point fait', 'points faits'), b.reste.length ? `${b.reste.length} à faire` : '',
      b.minutes ? dureeHM(b.minutes) : 'sans heures'].filter(Boolean).join(' · ')));
}
