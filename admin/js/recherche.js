// Chercher partout (la loupe, « / » ou ⌘K) : clients, prospects, tâches, récaps, documents,
// abonnements et dépenses. Tout se passe dans la page, sur ce que l'admin a déjà lu du serveur :
// aucune demande de plus, rien n'est gardé, et tout s'efface au verrouillage. Sans accents ni
// majuscules, chaque mot tapé doit se trouver quelque part (« plomb capi » trouve « Plomberie
// Capital »). Au clavier : ↑ ↓ pour choisir, Entrée pour ouvrir, Échap pour fermer.
import { $, icone, vider, normal, urlSure, relatif, date } from './outils.js';
import { el } from './formes.js';
import { E } from './etat.js';
import { montrer } from './navigation.js';
import { chargerClients, ouvrirClient } from './clients.js';
import { chargerProspects, voirProspects, choisirSousVue } from './prospects.js';
import { chargerEquipe, ouvrirTache, ouvrirDocument, voirRecap } from './equipe.js';
import { chargerArgent, ouvrirAbonnement, ouvrirDepense, argent, leJour } from './argent.js';
import { prenom } from './tableau.js';

const MONTRES = 5, DEPLIES = 30;
const GROUPES = {
  clients: { titre: 'Clients', icone: 'i-clients' },
  prospects: { titre: 'Prospects', icone: 'i-telephone' },
  taches: { titre: 'Tâches', icone: 'i-equipe' },
  recaps: { titre: 'Récaps', icone: 'i-note' },
  documents: { titre: 'Documents', icone: 'i-document' },
  abonnements: { titre: 'Abonnements', icone: 'i-argent' },
  depenses: { titre: 'Dépenses', icone: 'i-argent' }
};
const ORDRE = Object.keys(GROUPES);
const ui = { ouvert: false, retour: null, index: [], sources: null, options: [], actif: -1, cleActive: '',
  deplies: new Set(), lecture: false, dessin: 0, annonce: 0, vv: null };

// ─── Ce qu'on peut trouver ─────────────────────────────────────────────────
function article({ groupe, id, titre, meta = [], champs = [], ouvrir, poids = 0, externe = false }) {
  const t = String(titre || '').trim() || 'Sans nom';
  const m = meta.filter(Boolean).map(String).join(' · ');
  const c = [champs].flat(Infinity).filter(x => x != null && x !== '').map(String);
  return { groupe, id: String(id), titre: t, meta: m, champs: c, ouvrir, poids, externe,
    nTitre: normal(t), nMeta: normal(m), nTout: normal([t, m, ...c].join(' • ')) };
}
const chiffres = t => String(t || '').replace(/\D/g, '');
const hote = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return ''; } };
const OUVERTES = ['a_contacter', 'contacte', 'rendez_vous'];

function deClients() {
  if (!Array.isArray(E.clients)) return [];
  return E.clients.map(c => {
    const pct = Math.max(0, Math.min(100, parseInt(c.progress, 10) || 0));
    const etapes = (Array.isArray(c.checklist) ? c.checklist : []).filter(x => x && x.label);
    const suite = etapes.find(x => !x.done);
    return article({ groupe: 'clients', id: c.client_id, titre: c.project_name || c.client_id,
      meta: [c.username ? `@${c.username}` : '', `${pct} %`, suite ? `ensuite : ${suite.label}` : ''],
      champs: [c.client_id, c.notes, etapes.map(x => x.label), c.demo_url], poids: 1,
      ouvrir: () => { choisirSousVue('clients'); ouvrirClient(c.client_id); } });
  });
}

function deProspects() {
  const P = E.prospects;
  if (!P || !Array.isArray(P.prospects)) return [];
  const etapes = (P.regles && P.regles.etapes) || {};
  return P.prospects.map(p => article({ groupe: 'prospects', id: p.id, titre: p.entreprise,
    meta: [etapes[p.etape] || '', p.metier, p.secteur, p.telephone],
    champs: [p.courriel, p.site, p.notes, p.angle, p.prochaine_action, p.responsable_nom, chiffres(p.telephone),
      (p.historique || []).map(h => h.texte)],
    poids: OUVERTES.includes(p.etape) ? 1 : 0,
    ouvrir: () => voirProspects({ id: p.id }) }));
}

function deTaches() {
  const Q = E.equipe;
  if (!Q || !Array.isArray(Q.taches)) return [];
  const statut = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Faite' };
  return Q.taches.filter(t => t.statut !== 'annule').map(t => {
    const pour = t.pour === 'tous' ? 'pour tout le monde' : t.pour === Q.moi ? 'pour toi' : `pour ${prenom(t.pour_nom) || t.pour}`;
    const ouverte = t.statut !== 'fait';
    return article({ groupe: 'taches', id: t.id, titre: t.titre,
      meta: [statut[t.statut] || '', pour, ouverte && t.echeance ? `d’ici le ${leJour(t.echeance)}` : '',
        ouverte && t.priorite === 'urgente' ? 'urgente' : ''],
      champs: [t.details, t.lien, (t.notes || []).map(n => n.texte), t.de_nom, t.pour_nom],
      poids: ouverte ? 2 : 0,
      ouvrir: () => { montrer('equipe'); ouvrirTache(t.id); } });
  });
}

function deRecaps() {
  const Q = E.equipe;
  if (!Q || !Array.isArray(Q.recaps)) return [];
  return Q.recaps.map(r => {
    const d = date(r.fin) || date(r.cree_le);
    return article({ groupe: 'recaps', id: r.id, titre: r.titre,
      meta: [r.qui === Q.moi ? 'Par toi' : `Par ${prenom(r.nom) || r.qui}`, d ? relatif(d) : ''],
      champs: [r.fait, r.reste, r.liens, (r.notes || []).map(n => n.texte)],
      ouvrir: () => voirRecap(r.id) });
  });
}

function deDocuments() {
  const Q = E.equipe;
  if (!Q || !Array.isArray(Q.documents)) return [];
  return Q.documents.map(d => {
    const u = urlSure(d.lien);
    return article({ groupe: 'documents', id: d.id, titre: d.titre, meta: [d.note || hote(d.lien)], champs: [d.lien], externe: !!u,
      // Le document s'ouvre dans un nouvel onglet, comme dans la liste ; un lien illisible ouvre sa fiche
      ouvrir: () => { if (u) window.open(u, '_blank', 'noopener,noreferrer'); else { montrer('equipe'); ouvrirDocument(d.id); } } });
  });
}

function deAbonnements() {
  const A = E.argent;
  if (!A || !Array.isArray(A.abonnements)) return [];
  const etat = { termine: 'terminé', rembourse: 'remboursé' };
  return A.abonnements.map(ab => article({ groupe: 'abonnements', id: ab.id, titre: ab.nom || 'Client',
    meta: [ab.forfait_nom, `${argent(ab.total_mensuel)} par mois`, etat[ab.etat] || ''],
    champs: [ab.client, ab.notes], poids: ab.etat === 'actif' ? 1 : 0,
    ouvrir: () => ouvrirAbonnement(ab.id) }));
}

function deDepenses() {
  const A = E.argent;
  if (!A || !Array.isArray(A.depenses)) return [];
  const R = A.regles || {}, frequences = R.frequences || {}, categories = R.categories || {};
  return A.depenses.map(d => article({ groupe: 'depenses', id: d.id, titre: d.quoi,
    meta: [argent(d.cad), d.frequence && d.frequence !== 'unique' ? frequences[d.frequence] : '', categories[d.categorie],
      d.debut ? leJour(d.debut) : '', d.active === false ? 'arrêtée' : ''],
    champs: [d.note, d.service], poids: d.active === false ? 0 : 1,
    ouvrir: () => ouvrirDepense(d.id) }));
}

// Refait seulement quand une partie a été relue du serveur (chaque lecture remplace son objet)
function index() {
  const sources = [E.clients, E.prospects, E.equipe, E.argent];
  if (ui.sources && sources.every((s, i) => s === ui.sources[i])) return ui.index;
  ui.sources = sources;
  const sur = f => { try { return f(); } catch (e) { return []; } };   // une donnée inattendue n'empêche pas le reste
  ui.index = [deClients, deProspects, deTaches, deRecaps, deDocuments, deAbonnements, deDepenses].flatMap(sur);
  return ui.index;
}

// ─── Chercher ──────────────────────────────────────────────────────────────
const SEPARATEUR = /[^a-z0-9]/;
const COURT = 3;   // « e », « 55 » : seulement au début d'un mot (sinon presque tout correspond)
const debutDeMot = (n, i) => i === 0 || SEPARATEUR.test(n[i - 1]);
// Où le mot tapé se trouve : d'abord au début d'un mot, sinon (3 lettres et plus) n'importe où
function position(n, m) {
  let ailleurs = -1;
  for (let i = n.indexOf(m); i >= 0; i = n.indexOf(m, i + 1)) {
    if (debutDeMot(n, i)) return { i, debut: true };
    if (ailleurs < 0) ailleurs = i;
  }
  return ailleurs >= 0 && m.length >= COURT ? { i: ailleurs, debut: false } : null;
}
// Un mot au début du nom compte plus qu'au milieu, le nom plus que les détails, et le nom exact le plus
function noter(a, mots, q) {
  let s = 0;
  for (const m of mots) {
    const t = position(a.nTitre, m);
    if (t) s += t.debut ? 12 : 6;
    else if (position(a.nMeta, m)) s += 3;
    else if (position(a.nTout, m)) s += 1;
    else return 0;
  }
  if (a.nTitre === q) s += 60;
  else if (a.nTitre.startsWith(q)) s += 30;
  else {
    if (mots.length > 1 && a.nTitre.includes(q)) s += 12;
    if (a.nTitre.startsWith(mots[0])) s += 6;      // « plomb cote » : le client avant « Rappeler Plomberie Côté »
  }
  return s + a.poids;
}

export function chercher(texte) {
  const q = normal(texte).replace(/\s+/g, ' ').trim();
  if (!q) return { q, mots: [], groupes: [] };
  const mots = [...new Set(q.split(' '))];
  const par = new Map();
  index().forEach((a, rang) => {
    const s = noter(a, mots, q);
    if (!s) return;
    if (!par.has(a.groupe)) par.set(a.groupe, []);
    par.get(a.groupe).push({ a, s, rang });
  });
  // Le groupe du meilleur résultat d'abord : Entrée ouvre ce qu'on cherchait
  const groupes = [...par.entries()].map(([cle, l]) => {
    l.sort((x, y) => y.s - x.s || x.rang - y.rang);
    return { cle, liste: l.map(x => x.a), meilleur: l[0].s };
  }).sort((x, y) => y.meilleur - x.meilleur || ORDRE.indexOf(x.cle) - ORDRE.indexOf(y.cle));
  return { q, mots, groupes };
}

// Le texte sans accents ni majuscules, et pour chacun de ses caractères sa place dans l'original
function plan(texte) {
  let n = '';
  const place = [];
  for (let i = 0; i < texte.length; i++) {
    const c = normal(texte[i]);
    for (let k = 0; k < c.length; k++) { n += c[k]; place.push(i); }
  }
  return { n, place };
}

// Les mots trouvés en surbrillance (des éléments <mark>, jamais du HTML)
function morceaux(texte, mots) {
  const { n, place } = plan(texte);
  const zones = [];
  for (const m of mots) for (let i = n.indexOf(m); i >= 0; i = n.indexOf(m, i + 1)) {
    if (m.length >= COURT || debutDeMot(n, i)) zones.push([i, i + m.length]);
  }
  if (!zones.length) return [texte];
  zones.sort((x, y) => x[0] - y[0]);
  const unies = [];
  for (const z of zones) { const d = unies[unies.length - 1]; if (d && z[0] <= d[1]) d[1] = Math.max(d[1], z[1]); else unies.push([...z]); }
  const sortie = [];
  let pos = 0;
  for (const [a, b] of unies) {
    const debut = place[a], fin = place[b - 1] + 1;
    if (debut > pos) sortie.push(texte.slice(pos, debut));
    sortie.push(el('mark', null, texte.slice(debut, fin)));
    pos = fin;
  }
  if (pos < texte.length) sortie.push(texte.slice(pos));
  return sortie;
}

// Un mot trouvé ailleurs que dans le nom : le bout de texte où il est, pour comprendre pourquoi
function extrait(a, mots) {
  const manquants = mots.filter(m => !position(a.nTitre, m) && !position(a.nMeta, m));
  if (!manquants.length) return '';
  for (const brut of a.champs) {
    const c = brut.replace(/\s+/g, ' ').trim();
    const { n, place } = plan(c);
    let i = -1, lg = 0;
    for (const m of manquants) { const p = position(n, m); if (p && (i < 0 || p.i < i)) { i = p.i; lg = m.length; } }
    if (i < 0) continue;
    const debut = place[i], fin = place[i + lg - 1] + 1;
    let a0 = Math.max(0, debut - 28), b0 = Math.min(c.length, fin + 72);
    if (a0 > 0) { const e = c.indexOf(' ', a0); if (e >= 0 && e < debut) a0 = e + 1; }
    if (b0 < c.length) { const e = c.lastIndexOf(' ', b0); if (e > fin) b0 = e; }
    return `${a0 > 0 ? '…' : ''}${c.slice(a0, b0)}${b0 < c.length ? '…' : ''}`;
  }
  return '';
}

// ─── L'écran ───────────────────────────────────────────────────────────────
function manquent() {
  const l = [];
  if (!E.clientsLus) l.push('les clients');
  if (!E.prospects) l.push('les prospects');
  if (!E.equipe) l.push('l’équipe');
  if (!E.argent) l.push('l’argent');
  return l;
}
const liste = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : l[0] || '');

function dessiner() {
  ui.dessin = 0;
  if (!ui.ouvert) return;
  const champ = $('#chercher-champ'), boite = $('#chercher-resultats'), message = $('#chercher-message');
  const r = chercher(champ.value);
  const options = [];
  let k = 0;
  const groupes = r.groupes.map(g => {
    const G = GROUPES[g.cle];
    const max = ui.deplies.has(g.cle) ? DEPLIES : MONTRES;
    const lignes = g.liste.slice(0, max).map(a => {
      const ex = extrait(a, r.mots);
      const n = el('div', { class: 'resultat', role: 'option', id: `chercher-o${k++}`, 'aria-selected': 'false' },
        el('span', { class: `resultat__icone resultat__icone--${g.cle}`, 'aria-hidden': 'true' }, icone(G.icone)),
        el('span', { class: 'resultat__texte' },
          el('span', { class: 'resultat__titre' }, morceaux(a.titre, r.mots)),
          a.meta ? el('span', { class: 'resultat__meta' }, morceaux(a.meta, r.mots)) : null,
          ex ? el('span', { class: 'resultat__extrait' }, morceaux(ex, r.mots)) : null,
          a.externe ? el('span', { class: 'sr' }, '(s’ouvre dans un nouvel onglet)') : null),
        el('span', { class: 'resultat__aller', 'aria-hidden': 'true' }, a.externe ? icone('i-sortie') : '↵'));
      options.push({ n, cle: `${a.groupe}:${a.id}`, faire: a.ouvrir });
      return n;
    });
    const reste = Math.min(g.liste.length, DEPLIES) - lignes.length;
    if (reste > 0) {
      const n = el('div', { class: 'resultat resultat--plus', role: 'option', id: `chercher-o${k++}`, 'aria-selected': 'false' },
        el('span', { class: 'resultat__texte' }, `Voir ${reste === 1 ? 'l’autre' : `les ${reste} autres`} (${G.titre.toLowerCase()})`));
      options.push({ n, cle: `plus:${g.cle}`, plus: g.cle });
      lignes.push(n);
    }
    return el('div', { class: 'resultats__groupe', role: 'group', 'aria-labelledby': `chercher-g-${g.cle}` },
      el('div', { class: 'resultats__titre', role: 'presentation', id: `chercher-g-${g.cle}` }, G.titre,
        el('span', { class: 'resultats__n' }, g.liste.length > DEPLIES ? `${DEPLIES}+` : String(g.liste.length))),
      lignes);
  });
  vider(boite, groupes);
  boite.hidden = !options.length;
  ui.options = options;
  champ.setAttribute('aria-expanded', String(options.length > 0));

  // Le message : quoi chercher, rien trouvé, ou ce qui n'est pas encore lu
  const pas = manquent();
  const attente = pas.length ? (ui.lecture ? `Lecture de ${liste(pas)}…` : `Pas encore lu : ${liste(pas)}.`) : '';
  if (!r.q) vider(message, el('p', null, 'Cherche un client, un prospect, une tâche, un récap, un document, un abonnement ou une dépense.'),
    attente ? el('p', { class: 'chercher__attente' }, attente) : null);
  else if (!options.length) vider(message, el('p', null, 'Rien ne correspond à « ', el('b', null, champ.value.trim()), ' ».'),
    el('p', { class: 'chercher__attente' }, attente || 'Essaie un autre mot, ou seulement le début d’un nom.'));
  else vider(message, attente ? el('p', { class: 'chercher__attente' }, attente) : null);
  message.hidden = !message.childNodes.length;

  // Le même résultat reste choisi quand la liste change (une partie arrive du serveur), sinon le premier
  const i = options.findIndex(o => o.cle === ui.cleActive);
  activer(i >= 0 ? i : 0, { defiler: false });
  annoncer(r.q ? options.filter(o => !o.plus).length : -1);
}
const planifier = () => { if (!ui.dessin) ui.dessin = requestAnimationFrame(dessiner); };

function activer(i, { defiler = true } = {}) {
  const champ = $('#chercher-champ');
  if (!ui.options.length) { ui.actif = -1; ui.cleActive = ''; champ.removeAttribute('aria-activedescendant'); return; }
  i = (i + ui.options.length) % ui.options.length;
  ui.options.forEach((o, k) => o.n.setAttribute('aria-selected', String(k === i)));
  ui.actif = i;
  ui.cleActive = ui.options[i].cle;
  champ.setAttribute('aria-activedescendant', ui.options[i].n.id);
  if (defiler) ui.options[i].n.scrollIntoView({ block: 'nearest' });
}

// Pour les lecteurs d'écran : le nombre de résultats, un instant après la dernière touche
function annoncer(n) {
  clearTimeout(ui.annonce);
  if (n < 0) return;
  ui.annonce = setTimeout(() => {
    if (!ui.ouvert) return;
    $('#annonce').textContent = n ? `${n} résultat${n > 1 ? 's' : ''}${n > 1 ? ' : flèches pour choisir, Entrée pour ouvrir' : ', Entrée pour ouvrir'}.` : 'Aucun résultat.';
  }, 600);
}

function choisir(i) {
  const o = ui.options[i];
  if (!o) return;
  if (o.plus) {
    ui.deplies.add(o.plus);
    const avant = ui.options.filter(x => x.cle.startsWith(`${o.plus}:`)).length;
    dessiner();
    const suite = ui.options.filter(x => x.cle.startsWith(`${o.plus}:`))[avant];   // le premier qui vient d'apparaître
    if (suite) activer(ui.options.indexOf(suite));
    return;
  }
  fermerRecherche({ rendre: false });
  // Le panneau qui s'ouvre rendra le focus à la loupe en se fermant
  const loupe = $('#chercher-ouvrir');
  if (loupe) loupe.focus({ preventScroll: true });
  o.faire();
}

// Une partie pas encore lue (juste après l'entrée, ou un serveur lent) : on la lit, puis on refait la liste
function chargerManquants() {
  const travaux = [];
  if (!E.clientsLus) travaux.push(chargerClients());
  if (!E.prospects && E.prospectsErreur !== 'pas-encore') travaux.push(chargerProspects());
  if (!E.equipe && E.equipeErreur !== 'pas-encore') travaux.push(chargerEquipe());
  if (!E.argent && E.argentErreur !== 'pas-encore') travaux.push(chargerArgent());
  if (!travaux.length) return;
  ui.lecture = true;
  Promise.allSettled(travaux).then(() => { ui.lecture = false; if (ui.ouvert) dessiner(); });
}

// Sur téléphone, le clavier cache le bas de l'écran : la recherche tient dans ce qui reste visible
function suivreClavier(oui) {
  const vv = window.visualViewport;
  if (!vv) return;
  const racine = document.documentElement;
  if (oui && !ui.vv) {
    ui.vv = () => racine.style.setProperty('--visible', `${Math.round(vv.height)}px`);
    ui.vv();
    vv.addEventListener('resize', ui.vv);
  } else if (!oui && ui.vv) {
    vv.removeEventListener('resize', ui.vv);
    ui.vv = null;
    racine.style.removeProperty('--visible');
  }
}

// ─── Ouvrir, fermer ────────────────────────────────────────────────────────
export const rechercheOuverte = () => ui.ouvert;

export function ouvrirRecherche() {
  if (ui.ouvert || E.panneau || !$('#chercher')) return;
  ui.ouvert = true;
  ui.retour = document.activeElement;
  ui.deplies.clear();
  ui.cleActive = '';
  const fond = $('#chercher'), champ = $('#chercher-champ');
  fond.hidden = false;
  $('#appli').inert = true;
  document.documentElement.classList.add('avec-recherche');
  requestAnimationFrame(() => fond.classList.add('ouvert'));
  suivreClavier(true);
  chargerManquants();
  dessiner();
  champ.focus();
  champ.select();   // la recherche d'avant reste là : on tape par-dessus, ou on la reprend
}

export function fermerRecherche({ rendre = true } = {}) {
  if (!ui.ouvert) return;
  ui.ouvert = false;
  clearTimeout(ui.annonce);
  if (ui.dessin) { cancelAnimationFrame(ui.dessin); ui.dessin = 0; }
  const fond = $('#chercher');
  fond.classList.remove('ouvert');
  fond.hidden = true;
  if (!E.panneau) $('#appli').inert = false;
  document.documentElement.classList.remove('avec-recherche');
  suivreClavier(false);
  const r = ui.retour;
  ui.retour = null;
  if (rendre && r && document.contains(r) && !r.closest('#chercher')) r.focus({ preventScroll: true });
}

// Au verrouillage : la recherche se ferme et oublie tout (rien ne reste dans la page)
export function viderRecherche() {
  fermerRecherche({ rendre: false });
  if (!$('#chercher')) return;
  $('#chercher-champ').value = '';
  $('#chercher-champ').removeAttribute('aria-activedescendant');
  vider($('#chercher-resultats'));
  vider($('#chercher-message'));
  Object.assign(ui, { index: [], sources: null, options: [], actif: -1, cleActive: '' });
  ui.deplies.clear();
}

// ─── Clavier, souris et doigt ──────────────────────────────────────────────
function brancher() {
  const fond = $('#chercher');
  if (!fond) return;                                   // une page d'une version plus ancienne
  const champ = $('#chercher-champ'), boite = $('#chercher-resultats');
  fond.addEventListener('keydown', e => {
    e.stopPropagation();                               // les raccourcis de l'admin attendent la fermeture
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); fermerRecherche(); return; }
    // ⌘K une 2e fois : le navigateur n'a pas la main (sa barre d'adresse), on reprend le texte tapé
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      champ.focus();
      champ.select();
      return;
    }
    if (e.key === 'Tab') {                             // le focus reste ici : le champ, puis Fermer
      e.preventDefault();
      (document.activeElement === champ ? $('#chercher-fermer') : champ).focus();
      return;
    }
    if (e.target !== champ) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activer(ui.actif + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activer(ui.actif - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (ui.actif >= 0) choisir(ui.actif); }
  });
  champ.addEventListener('input', () => { ui.deplies.clear(); ui.cleActive = ''; planifier(); });
  boite.addEventListener('mousedown', e => e.preventDefault());   // le focus reste dans le champ
  boite.addEventListener('click', e => {
    const o = e.target.closest('[role="option"]');
    if (o) choisir(ui.options.findIndex(x => x.n === o));
  });
  boite.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const o = e.target.closest('[role="option"]');
    const i = o ? ui.options.findIndex(x => x.n === o) : -1;
    if (i >= 0 && i !== ui.actif) activer(i, { defiler: false });
  });
  fond.addEventListener('click', e => { if (e.target === fond) fermerRecherche(); });
  $('#chercher-fermer').addEventListener('click', () => fermerRecherche());
}
brancher();
