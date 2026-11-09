// Prospects : les entreprises qu'on aimerait comme clients, par étape (à contacter, contacté,
// rendez-vous, signé, pas pour nous), avec la prochaine action et sa date, qui s'en occupe, et
// chaque contact (appel, courriel, texto, visite, note). Ce que demande la loi anti-pourriel
// reste sous les yeux : le courriel publié par l'entreprise, la preuve, « ne plus contacter ».
// Le serveur garde tout dans la feuille du portail ; l'app montre et envoie. Chaque ajout porte
// une clé tirée au hasard : envoyé deux fois, il n'est ajouté qu'une fois.
import { $, icone, vider, pluriel, majuscule, date, relatif, ymd, toast, lienTel, lienCourriel, urlSure, normal, lire, ecrire as garder } from './outils.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { fermerPanneau } from './panneau.js';
import { prenom, rendreBonjour } from './tableau.js';
import { montrer } from './navigation.js';
import { ouvrirNouveau } from './clients.js';
import { el, Invalide, nouvelleCle, badge, confirmations, champTexte, champDate, pilules, bascule,
  panneauFormulaire as panneauBase } from './formes.js';

const ui = { filtre: 'actifs', charge: null, confirmer: '' };
const CLE_SOUS_VUE = 'uio-admin-sous-vue';
const ETAPES = { a_contacter: 'À contacter', contacte: 'Contacté', rendez_vous: 'Rendez-vous', signe: 'Signé', perdu: 'Pas pour nous' };
const OUVERTES = ['a_contacter', 'contacte', 'rendez_vous'];
const SORTES = { appel: 'Appel', courriel: 'Courriel', texto: 'Texto', visite: 'Visite', note: 'Note' };
const PRIORITES = [['A', 'A · infos vérifiées'], ['B', 'B · annuaire'], ['C', 'C · plus tard']];
const GENRE = { a_contacter: 'neutre', contacte: 'bleu', rendez_vous: 'voix', signe: '', perdu: 'neutre' };
const ICONES = { appel: 'i-telephone', courriel: 'i-document', texto: 'i-note', visite: 'i-clients', note: 'i-note', etape: 'i-ok', cree: 'i-plus' };

// ─── Personnes et dates ────────────────────────────────────────────────────
const moi = () => (E.prospects && E.prospects.moi) || ((sessionActuelle() || {}).admin || {}).identifiant || '';
const gens = () => (E.prospects && E.prospects.personnes) || [];
const prenomDe = (id, nom = '') => prenom(nom) || prenom((gens().find(p => p.identifiant === id) || {}).nom) || id;
const quiEst = (id, nom = '') => (id === moi() ? 'toi' : prenomDe(id, nom));
// L'ordre des étapes vient d'ici : le serveur renvoie ses objets avec les clés triées (alphabet).
function etapes() {
  const s = (E.prospects && E.prospects.regles && E.prospects.regles.etapes) || {};
  const o = {};
  for (const k of [...Object.keys(ETAPES), ...Object.keys(s)]) if (!(k in o)) o[k] = s[k] || ETAPES[k];
  return o;
}
const jourIso = iso => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const ecartJours = iso => Math.round((jourIso(iso) - jourIso(ymd(new Date()))) / 864e5);
function pourQuand(iso) {
  const n = ecartJours(iso);
  if (n === 0) return 'aujourd’hui';
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  if (n > 1 && n < 7) return jourIso(iso).toLocaleDateString('fr-CA', { timeZone: 'UTC', weekday: 'long' });
  return 'le ' + jourIso(iso).toLocaleDateString('fr-CA', { timeZone: 'UTC', day: 'numeric', month: 'long' });
}
const quand = d => { if (!d) return ''; const r = relatif(d); return /^\d/.test(r) ? `le ${r}` : r; };
const hote = u => { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).slice(0, 40); } catch (e) { return u; } };
const trouver = id => (E.prospects ? E.prospects.prospects.find(p => p.id === id) : null);

// ─── Lecture et écriture ───────────────────────────────────────────────────
export function chargerProspects({ frais = false, auto = false } = {}) {
  if (auto && ((E.panneau && E.panneau.modifie && E.panneau.modifie()) || ui.confirmer)) return Promise.resolve();
  if (ui.charge) return ui.charge;
  const s = sessionActuelle();
  ui.charge = api('/portal/admin/prospects' + (frais ? '?frais=1' : ''), { delai: 60000 })
    .then(d => { if (sessionActuelle() === s) { E.prospects = d; E.prospectsErreur = ''; E.prospectsLu = Date.now(); } })
    .catch(e => { if (e.statut !== 401 && sessionActuelle() === s) E.prospectsErreur = e.statut === 404 ? 'pas-encore' : e.message; })
    .finally(() => {
      ui.charge = null;
      if (sessionActuelle() !== s) return;
      rendreProspects();
      rendreBonjour();
      if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
    });
  return ui.charge;
}

// Chaque changement renvoie tous les prospects : l'écran suit tout de suite.
async function ecrire(chemin, corps) {
  const s = sessionActuelle();
  const r = await api(`/portal/admin/${chemin}`, { methode: 'POST', corps, delai: 45000 });
  if (sessionActuelle() !== s) return r;
  if (r.prospects) { E.prospects = r.prospects; E.prospectsErreur = ''; E.prospectsLu = Date.now(); }
  rendreProspects();
  rendreBonjour();
  if (E.panneau && E.panneau.rafraichir) E.panneau.rafraichir();
  return r;
}
const panneauFormulaire = o => panneauBase({ ...o, ecrire });

export function viderProspects() {
  E.prospects = null; E.prospectsErreur = ''; E.prospectsLu = 0; E.rechercheProspects = '';
  Object.assign(ui, { filtre: 'actifs', confirmer: '' });
  if ($('#prospects')) rendreProspects();
}

function pret() {
  if (E.prospects) return true;
  toast(E.prospectsErreur === 'pas-encore' ? 'Le serveur n’a pas encore les prospects : il faut d’abord le mettre à jour.' : 'Les prospects ne sont pas encore lus. Réessaie dans un instant.', true);
  if (!E.prospectsErreur) chargerProspects();
  return false;
}

// ─── Clients ou prospects (dans l'onglet Clients) ──────────────────────────
export function sousVue() { return E.sousClients === 'prospects' ? 'prospects' : 'clients'; }
export function choisirSousVue(vue, { garder: retenir = true } = {}) {
  E.sousClients = vue === 'prospects' ? 'prospects' : 'clients';
  if (retenir) garder('sessionStorage', CLE_SOUS_VUE, E.sousClients);
  const p = E.sousClients === 'prospects';
  if (!$('#prospects')) return;                    // une page d'une version plus ancienne
  $('#voir-clients').setAttribute('aria-pressed', String(!p));
  $('#voir-prospects').setAttribute('aria-pressed', String(p));
  $('#clients-liste').hidden = p;
  $('#prospects').hidden = !p;
  $('#clients-titre').textContent = p ? 'Prospects' : 'Clients';
  $('#nouveau-client').textContent = p ? 'Nouveau prospect' : 'Nouveau client';
  $('#recherche').placeholder = p ? 'Chercher un prospect' : 'Chercher un client';
  $('label[for="recherche"]').textContent = p ? 'Chercher un prospect' : 'Chercher un client';
  $('#recherche').value = (p ? E.rechercheProspects : E.recherche) || '';
  majCompte();
  if (p && (!E.prospects || Date.now() - (E.prospectsLu || 0) > 30e3)) chargerProspects();
  rendreProspects();
}
export function reprendreSousVue() { choisirSousVue(lire('sessionStorage', CLE_SOUS_VUE) || 'clients', { garder: false }); }

function majCompte() {
  const nP = E.prospects ? String(E.prospects.prospects.length) : '';
  const nC = E.clientsLus ? String(E.clients.length) : '';
  const n = $('#n-prospects'); if (n) n.textContent = nP;
  const c = $('#n-clients'); if (c) c.textContent = nC;
  const t = $('#clients-compte'); if (t) t.textContent = sousVue() === 'prospects' ? nP : nC;
}

// Depuis le tableau de bord (« 3 prospects à relancer ») ou la recherche
export function voirProspects({ filtre = '', id = '' } = {}) {
  montrer('clients');
  choisirSousVue('prospects');
  if (filtre) { ui.filtre = filtre; rendreProspects(); }
  if (id) ouvrirProspect(id);
}
document.addEventListener('uio:prospects', e => voirProspects(e.detail || {}));
document.addEventListener('uio:prospect-depuis-demande', e => {
  montrer('clients');
  choisirSousVue('prospects');
  const d = e.detail || {};
  const lancer = () => ouvrirNouveauProspect({
    entreprise: d.entreprise || d.nom || '', telephone: d.telephone || '', courriel: d.courriel || '',
    preuve: d.courriel ? `A écrit au chatbot du site le ${String(d.date || '').slice(0, 10)}` : '',
    notes: [d.nom && d.entreprise ? `Contact : ${d.nom}` : '', d.besoin ? `Besoin : ${d.besoin}` : '', d.resume || ''].filter(Boolean).join('\n'),
    depuis: 'demande'
  });
  if (E.prospects) lancer(); else chargerProspects().then(() => { if (E.prospects) lancer(); });
});

// ─── La liste ──────────────────────────────────────────────────────────────
function filtrees() {
  const tous = E.prospects ? E.prospects.prospects : [];
  const q = normal(E.rechercheProspects);
  const cherche = q ? tous.filter(p => normal(`${p.entreprise} ${p.metier} ${p.secteur} ${p.telephone} ${p.courriel} ${p.site} ${p.notes} ${p.angle}`).includes(q)) : tous;
  if (ui.filtre === 'tous') return cherche;
  if (ui.filtre === 'relancer') return cherche.filter(p => p.jours_retard != null && p.jours_retard >= 0);
  if (ui.filtre === 'actifs') return cherche.filter(p => OUVERTES.includes(p.etape));
  return cherche.filter(p => p.etape === ui.filtre);
}

export function rendreProspects() {
  const boite = $('#prospects');
  if (!boite) return;
  majCompte();
  if (!E.prospects) {
    return vider(boite, el('p', { class: 'vide' }, E.prospectsErreur === 'pas-encore'
      ? 'Les prospects s’afficheront ici dès que le serveur aura reçu sa mise à jour.' : E.prospectsErreur || 'Lecture des prospects…'));
  }
  const d = E.prospects, liste = d.prospects;
  if (!liste.length) {
    return vider(boite, el('div', { class: 'vide vide--action' },
      el('p', null, 'Aucun prospect pour l’instant. Ajoute le premier, ou colle une liste copiée d’un tableur.'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn--petit', type: 'button', onclick: () => ouvrirNouveauProspect() }, 'Nouveau prospect'),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => ouvrirCollageListe() }, icone('i-coller'), 'Coller une liste'))));
  }
  const ouverts = liste.filter(p => OUVERTES.includes(p.etape)).length;
  // L'entonnoir : une tuile par étape, qui filtre la liste (un 2e toucher revient à « En cours »)
  const tuiles = el('div', { class: 'entonnoir', role: 'group', 'aria-label': 'Étapes' },
    Object.entries(etapes()).map(([k, t]) => {
      const n = d.compte[k] || 0;
      return el('button', { class: `etape-tuile etape-tuile--${k}`, type: 'button', 'aria-pressed': String(ui.filtre === k), 'data-focus': `etape-${k}`,
        onclick: () => { ui.filtre = ui.filtre === k ? 'actifs' : k; rendreProspects(); } },
        el('b', null, String(n)), el('span', null, t),
        el('i', { class: 'etape-tuile__barre', 'aria-hidden': 'true', style: `--part:${liste.length ? Math.max(n ? 6 : 0, Math.round(n / liste.length * 100)) : 0}%` }));
    }));
  const filtres = el('div', { class: 'filtres', role: 'group', 'aria-label': 'Montrer' },
    [['actifs', 'En cours', ouverts], ['relancer', 'À relancer', d.a_relancer], ['tous', 'Tous', liste.length]].map(([v, t, n]) =>
      el('button', { class: `filtre${v === 'relancer' && n ? ' filtre--alerte' : ''}`, type: 'button', 'aria-pressed': String(ui.filtre === v), 'data-focus': `pfiltre-${v}`,
        onclick: () => { ui.filtre = v; rendreProspects(); } }, t, el('span', { class: 'filtre__n' }, String(n)))),
    el('button', { class: 'lien ml-auto', type: 'button', onclick: () => ouvrirCollageListe() }, 'Coller une liste'));
  const montres = filtrees();
  const titreFiltre = { actifs: 'en cours', relancer: 'à relancer', tous: '' }[ui.filtre] ?? `à l’étape « ${etapes()[ui.filtre]} »`;
  const vide = E.rechercheProspects
    ? `Aucun prospect ${titreFiltre ? titreFiltre + ' ' : ''}ne correspond à « ${E.rechercheProspects} ».`
    : ui.filtre === 'relancer' ? 'Aucune relance à faire aujourd’hui.' : `Aucun prospect ${titreFiltre}.`;
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : '';
  vider(boite, tuiles, filtres,
    montres.length ? el('ul', { class: 'prospects__liste' }, montres.map(ligneProspect)) : el('p', { class: 'vide' }, vide));
  if (focus) { const n = document.querySelector(`[data-focus="${CSS.escape(focus)}"]`); if (n) n.focus({ preventScroll: true }); }
}

function badgeRelance(p) {
  if (p.jours_retard == null || p.jours_retard < 0) return null;
  if (p.jours_retard === 0) return badge('À relancer aujourd’hui', 'attente');
  return badge(p.jours_retard === 1 ? 'Relance en retard d’un jour' : `Relance en retard de ${p.jours_retard} j`, 'alerte');
}
const quiSOccupe = p => (!p.responsable ? '' : p.responsable === moi() ? 'Tu t’en occupes' : `${prenomDe(p.responsable, p.responsable_nom)} s’en occupe`);
function ensuite(p) {
  if (!p.prochaine_action && !p.prochaine_date) return '';
  const action = p.prochaine_action || 'relancer';
  const jour = p.prochaine_date ? pourQuand(p.prochaine_date) : '';
  // « Démo jeudi 9 h » pour jeudi : le jour n'est pas répété entre parenthèses
  return `Ensuite : ${action}${jour && !normal(action).includes(normal(jour.replace(/^le /, ''))) ? ` (${jour})` : ''}`;
}

function ligneProspect(p) {
  const tel = lienTel(p.telephone);
  const meta = [p.metier, p.secteur, quiSOccupe(p)].filter(Boolean).join(' · ');
  const suite = ensuite(p) || (p.etape === 'a_contacter' && p.angle ? `Angle : ${p.angle}` : '');
  return el('li', { class: `prospect${p.jours_retard > 0 ? ' prospect--retard' : ''}${p.etape === 'perdu' ? ' prospect--perdu' : ''}` },
    el('button', { class: 'prospect__corps', type: 'button', 'data-focus': `prospect-${p.id}`, onclick: () => ouvrirProspect(p.id) },
      el('span', { class: 'prospect__haut' },
        el('span', { class: 'prospect__nom' }, p.entreprise),
        el('span', { class: 'prospect__badges' },
          el('span', { class: `priorite priorite--${p.priorite}`, title: `Priorité ${p.priorite}` }, el('span', { class: 'sr' }, 'Priorité '), p.priorite),
          badge(etapes()[p.etape] || p.etape, GENRE[p.etape]),
          p.ne_pas_contacter ? badge('Ne plus contacter', 'alerte') : null)),
      meta ? el('span', { class: 'prospect__meta' }, meta) : null,
      badgeRelance(p),
      suite ? el('span', { class: 'prospect__suite' }, suite) : null,
      el('span', { class: 'prospect__meta' }, p.dernier_contact ? `Dernier contact ${quand(date(p.dernier_contact))} · ${pluriel(p.contacts, 'contact', 'contacts')}` : 'Pas encore contacté')),
    tel ? el('a', { class: 'puce tel prospect__appel', href: tel, 'aria-label': `Appeler ${p.entreprise} au ${p.telephone}` }, icone('i-telephone'), p.telephone) : null);
}

// ─── La fiche d'un prospect : contact, suivi, historique ───────────────────
function titreEvenement(e) {
  if (e.sorte === 'cree') return 'Ajouté aux prospects';
  if (e.sorte === 'etape') {
    const [a, b] = String(e.etape || '').split('>');
    return `Étape : ${etapes()[a] || a} → ${etapes()[b] || b}`;
  }
  return SORTES[e.sorte] || e.sorte;
}
function histoire(p) {
  if (!p.historique.length) return el('p', { class: 'vide' }, 'Rien encore.');
  return el('ol', { class: 'histoire' }, p.historique.map(e => el('li', { class: `histoire__point histoire--${e.sorte}` },
    el('span', { class: 'histoire__icone', 'aria-hidden': 'true' }, icone(ICONES[e.sorte] || 'i-note')),
    el('div', { class: 'histoire__corps' },
      el('p', { class: 'histoire__titre' }, titreEvenement(e)),
      e.texte ? el('p', { class: 'histoire__texte' }, e.texte) : null,
      el('p', { class: 'histoire__meta' }, `${majuscule(quiEst(e.qui, e.qui_nom))}, ${quand(date(e.quand))}`)))));
}

function blocContact(p) {
  const tel = lienTel(p.telephone), courriel = !p.ne_pas_contacter && lienCourriel(p.courriel), site = urlSure(p.site);
  const b = x => el('b', null, x);
  const faits = [
    el('li', null, b(etapes()[p.etape]), ` · priorité ${p.priorite}`, quiSOccupe(p) ? ` · ${quiSOccupe(p)}` : ''),
    ensuite(p) ? el('li', { class: p.jours_retard > 0 ? 'faits__alerte' : null }, ensuite(p), p.jours_retard > 0 ? ` : en retard de ${pluriel(p.jours_retard, 'jour', 'jours')}` : '') : null,
    p.angle ? el('li', null, 'Angle : ', p.angle) : null,
    p.urgence ? el('li', null, 'Urgences ou 24 h : ', p.urgence) : null,
    p.canal ? el('li', null, 'Canal conseillé : ', p.canal) : null,
    p.courriel ? el('li', null, 'Courriel : ', b(p.courriel), p.preuve ? ` (preuve : ${p.preuve})` : ' (preuve à noter)') : null,
    p.client ? el('li', null, 'Espace client : ', b(p.client)) : null,
    p.notes ? el('li', { class: 'faits__note' }, p.notes) : null
  ];
  return el('div', { class: 'bloc' },
    p.ne_pas_contacter ? el('p', { class: 'alerte' }, el('b', null, 'Ne plus contacter. '),
      'ARRÊT reçu, ou « pas de sollicitation » sur son site : aucun courriel, aucun appel de vente.') : null,
    (tel || courriel || site) ? el('div', { class: 'actions' },
      tel && !p.ne_pas_contacter ? el('a', { class: 'puce tel', href: tel }, icone('i-telephone'), `Appeler ${p.telephone}`) : null,
      courriel ? el('a', { class: 'puce', href: courriel }, 'Écrire') : null,
      site ? el('a', { class: 'puce puce--lien', href: site, target: '_blank', rel: 'noopener' }, el('span', null, hote(site)), icone('i-sortie')) : null) : null,
    el('ul', { class: 'faits' }, faits));
}

export function ouvrirProspect(id) {
  if (!pret()) return;
  const p = trouver(id);
  if (!p) return toast('Ce prospect n’existe plus.', true);
  const contacte = s => (p.etape === 'a_contacter' && s !== 'note' ? 'contacte' : p.etape);
  const sorte = pilules('Quoi', Object.entries(SORTES), 'appel', s => etape.choisir(contacte(s)), { petit: true });
  const texte = champTexte('Ce qui s’est passé', { multiligne: true, rows: 3, maxlength: 400,
    placeholder: 'Ex. : Pas de réponse, message laissé. Il veut une démo jeudi.' }, '', 'facultatif');
  const etape = pilules('Étape', Object.entries(etapes()), contacte('appel'), undefined, { petit: true });
  const action = champTexte('Prochaine action', { maxlength: 160, autocomplete: 'off', placeholder: 'Ex. : Rappeler jeudi avant 10 h' }, '', 'facultatif');
  action.input.value = p.prochaine_action || '';
  const jour = champDate('Pour quand', p.prochaine_date, { facultatif: 'facultatif' });
  const nePas = bascule('Il ne veut plus être contacté', 'ARRÊT, désabonnement ou « pas de sollicitation ».', false);
  const depart = () => ({ texte: '', action: p.prochaine_action || '', jour: p.prochaine_date || '', nePas: false });
  const valeurs = () => ({ texte: texte.input.value.trim(), action: action.input.value.trim(), jour: jour.input.value, nePas: nePas.input.checked });
  const cle = nouvelleCle('ev');

  const zone = el('div', { class: 'bloc' });
  const dessiner = () => {
    const x = trouver(p.id);
    if (!x) return;
    vider(zone, el('h3', { class: 'panneau__intertitre' }, 'Historique'), histoire(x));
  };
  dessiner();
  const actions = el('div', { class: 'actions' });
  const etatActions = { confirmer: '' };
  const confirmerIci = confirmations(etatActions, () => dessinerActions());
  const dessinerActions = () => vider(actions,
    el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { fermerPanneau(); if (!E.panneau) modifierProspect(p.id); } }, icone('i-crayon'), 'Modifier la fiche'),
    p.etape === 'signe' && !p.client ? el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => creerEspaceClient(p) }, 'Créer son espace client') : null,
    confirmerIci('retirer', 'Retirer', `Retirer ${p.entreprise} des prospects ?`, async () => {
      await ecrire('prospect', { id: p.id, retirer: true });
      fermerPanneau(true);
      toast(`${p.entreprise} est retiré des prospects.`);
    }));
  dessinerActions();

  panneauFormulaire({
    titre: p.entreprise, sousTitre: [p.metier, p.secteur].filter(Boolean).join(' · ') || etapes()[p.etape],
    avant: [blocContact(p), el('h3', { class: 'panneau__intertitre' }, 'Noter un suivi')],
    corps: [sorte.boite, texte.boite, etape.boite, el('div', { class: 'deux' }, action.boite, jour.boite), nePas.boite],
    apres: [zone, actions], bouton: 'Noter le suivi', chemin: 'prospect/suivi',
    preparer: () => {
      const v = valeurs(), s = sorte.lire();
      if (s === 'note' && !v.texte) throw new Invalide('Écris la note.', texte.input);
      return { id: p.id, sorte: s, texte: v.texte, etape: etape.lire(), prochaine_action: v.action, prochaine_date: v.jour,
        ne_pas_contacter: v.nePas || undefined, cle };
    },
    reussite: () => (etape.lire() !== p.etape ? `Suivi noté : ${p.entreprise} passe à « ${etapes()[etape.lire()]} ».` : 'Suivi noté.'),
    modifie: () => JSON.stringify(valeurs()) !== JSON.stringify(depart()),
    focus: () => $('#panneau-titre'),
    rafraichir: () => dessiner()
  });
}

// Le prospect est signé : son accès à l'espace client, puis le lien entre les deux
function creerEspaceClient(p) {
  fermerPanneau();
  if (E.panneau) return;
  ouvrirNouveau({ projet: p.entreprise, courriel: p.courriel, telephone: p.telephone, quandCree: async clientId => {
    try { await ecrire('prospect', { id: p.id, client: clientId }); } catch (e) { /* le client existe quand même */ }
  } });
}

// ─── Nouveau prospect, ou la fiche à changer ───────────────────────────────
export function ouvrirNouveauProspect(preset = {}) { return modifierProspect('', preset); }

export function modifierProspect(id = '', preset = {}) {
  if (!pret()) return;
  const p = id ? trouver(id) : null;
  if (id && !p) return toast('Ce prospect n’existe plus.', true);
  const v0 = p || { entreprise: '', metier: '', secteur: '', telephone: '', site: '', courriel: '', preuve: '', priorite: 'B', etape: 'a_contacter',
    responsable: '', prochaine_action: '', prochaine_date: '', canal: '', angle: '', urgence: '', ne_pas_contacter: false, notes: '', ...preset };
  const texte = (etiquette, cle, attrs = {}, aide = '', facultatif = 'facultatif') => {
    const c = champTexte(etiquette, { autocomplete: 'off', ...attrs }, aide, facultatif);
    c.input.value = v0[cle] || '';
    return c;
  };
  const entreprise = texte('Entreprise', 'entreprise', { maxlength: 100, placeholder: 'Ex. : Plomberie Côté', enterkeyhint: 'next' }, '', '');
  const metier = texte('Métier', 'metier', { maxlength: 60, placeholder: 'Ex. : Plomberie' });
  const secteur = texte('Secteur', 'secteur', { maxlength: 120, placeholder: 'Les villes qu’il dessert' });
  const telephone = texte('Téléphone', 'telephone', { type: 'tel', inputmode: 'tel', maxlength: 40 });
  const site = texte('Site web', 'site', { type: 'url', inputmode: 'url', maxlength: 200, placeholder: 'plomberie.com', autocapitalize: 'none', spellcheck: 'false' });
  const courriel = texte('Courriel publié par l’entreprise', 'courriel', { type: 'email', inputmode: 'email', maxlength: 120, autocapitalize: 'none', spellcheck: 'false' },
    'Seulement un courriel que l’entreprise affiche elle-même (loi anti-pourriel).');
  const preuve = texte('Preuve', 'preuve', { maxlength: 300, placeholder: 'Ex. : plomberie.com (accueil), vu le 2026-11-08' }, 'Où et quand tu as vu ce courriel.');
  const priorite = pilules('Priorité', PRIORITES, v0.priorite, undefined, { petit: true });
  const etape = pilules('Étape', Object.entries(etapes()), v0.etape, undefined, { petit: true });
  const options = [['', 'Personne'], ...gens().map(g => [g.identifiant, g.identifiant === moi() ? 'Moi' : prenom(g.nom) || g.identifiant])];
  if (v0.responsable && !options.some(o => o[0] === v0.responsable)) options.push([v0.responsable, prenomDe(v0.responsable, v0.responsable_nom)]);
  const responsable = pilules('Qui s’en occupe', options, v0.responsable || '', undefined, { petit: true });
  const action = texte('Prochaine action', 'prochaine_action', { maxlength: 160, placeholder: 'Ex. : Rappeler jeudi avant 10 h' });
  const jour = champDate('Pour quand', v0.prochaine_date, { facultatif: 'facultatif' });
  const angle = texte('Angle d’approche', 'angle', { multiligne: true, rows: 2, maxlength: 300, placeholder: 'Ex. : Promet 24/7 : qui répond la nuit ?' });
  const urgence = texte('Urgences ou 24 h annoncés', 'urgence', { maxlength: 80, placeholder: 'Ex. : Oui, 24 h sur 24' });
  const canal = texte('Canal conseillé', 'canal', { maxlength: 80, placeholder: 'Ex. : Appel, puis visite' });
  const notes = texte('Notes', 'notes', { multiligne: true, rows: 4, maxlength: 3000 });
  const nePas = bascule('Ne plus contacter', 'ARRÊT reçu, ou « pas de sollicitation » sur son site.', !!v0.ne_pas_contacter);
  const valeurs = () => ({
    entreprise: entreprise.input.value.trim(), metier: metier.input.value.trim(), secteur: secteur.input.value.trim(),
    telephone: telephone.input.value.trim(), site: site.input.value.trim(), courriel: courriel.input.value.trim(), preuve: preuve.input.value.trim(),
    priorite: priorite.lire(), etape: etape.lire(), responsable: responsable.lire(), prochaine_action: action.input.value.trim(),
    prochaine_date: jour.input.value, angle: angle.input.value.trim(), urgence: urgence.input.value.trim(), canal: canal.input.value.trim(),
    notes: notes.input.value.trim(), ne_pas_contacter: nePas.input.checked
  });
  const depart = valeurs();
  const cle = nouvelleCle('pr');
  panneauFormulaire({
    titre: p ? p.entreprise : 'Nouveau prospect', sousTitre: p ? 'La fiche du prospect' : 'Une entreprise qu’on aimerait comme cliente',
    edition: !!p, bouton: p ? 'Enregistrer' : 'Ajouter le prospect', chemin: 'prospect',
    corps: [entreprise.boite, el('div', { class: 'deux' }, metier.boite, secteur.boite), el('div', { class: 'deux' }, telephone.boite, site.boite),
      courriel.boite, preuve.boite, priorite.boite, etape.boite, responsable.boite, el('div', { class: 'deux' }, action.boite, jour.boite),
      angle.boite, el('div', { class: 'deux' }, urgence.boite, canal.boite), notes.boite, nePas.boite],
    preparer: () => {
      const v = valeurs();
      if (!v.entreprise) throw new Invalide('Écris le nom de l’entreprise.', entreprise.input);
      if (v.telephone && v.telephone.replace(/\D/g, '').length < 7) throw new Invalide('Le téléphone : écris le numéro (ou laisse la case vide).', telephone.input);
      if (v.courriel && !lienCourriel(v.courriel)) throw new Invalide('Le courriel n’a pas l’air valide (ex. : info@plomberie.com).', courriel.input);
      const meme = E.prospects.prospects.find(x => x.id !== (p && p.id) && normal(x.entreprise) === normal(v.entreprise));
      if (meme) throw new Invalide(`${meme.entreprise} est déjà dans les prospects.`, entreprise.input);
      if (!p) return { ...v, cle, depuis: preset.depuis || undefined };
      const changes = { id: p.id };
      for (const k of Object.keys(v)) if (v[k] !== depart[k]) changes[k] = v[k];
      return changes;
    },
    reussite: () => (p ? 'Fiche enregistrée.' : `${valeurs().entreprise} est ajouté aux prospects.`),
    modifie: () => JSON.stringify(valeurs()) !== JSON.stringify(depart),
    focus: () => (p ? $('#panneau-titre') : entreprise.input)
  });
}

// ─── Coller une liste copiée d'un tableur (Google Sheets, Excel, Numbers) ──
// La 1re ligne donne les colonnes ; on reconnaît Entreprise, Métier, Secteur, Téléphone,
// Site, Courriel, Preuve, Priorité, Angle, Canal, Urgence, Notes et « pas de sollicitation ».
const COLONNES = [
  ['entreprise', ['entreprise', 'nom de l entreprise', 'compagnie', 'business', 'nom']], ['metier', ['metier', 'domaine', 'trade']],
  ['secteur', ['secteur', 'ville', 'region', 'zone']], ['telephone', ['telephone', 'tel', 'phone', 'numero']],
  ['site', ['site', 'web', 'website']], ['courriel', ['courriel', 'email', 'e mail', 'adresse courriel']],
  ['preuve', ['preuve', 'source']], ['priorite', ['priorite', 'priority']], ['angle', ['angle']],
  ['canal', ['canal']], ['urgence', ['24 h', '24h', 'urgence']], ['notes', ['notes', 'note', 'commentaire']],
  ['ne_pas_contacter', ['mention pas de sollicitation', 'pas de sollicitation', 'ne plus contacter']]
];
export function lireListe(texte) {
  const lignes = String(texte || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  if (lignes.length < 2) return { prospects: [], colonnes: [] };
  const sep = lignes[0].includes('\t') ? '\t' : lignes[0].includes(';') ? ';' : ',';
  const tete = lignes[0].split(sep).map(t => normal(t).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim());
  const index = {};
  for (const [champ, noms] of COLONNES) {
    const i = tete.findIndex((t, j) => !Object.values(index).includes(j) && noms.some(n => t === n || t.startsWith(n + ' ')));
    if (i >= 0) index[champ] = i;
  }
  if (index.entreprise == null) return { prospects: [], colonnes: [], erreur: 'La 1re ligne doit nommer les colonnes, dont « Entreprise ».' };
  const prospects = lignes.slice(1).map(l => {
    const c = l.split(sep).map(x => x.trim());
    const v = {};
    for (const [champ, i] of Object.entries(index)) v[champ] = c[i] || '';
    // « À trouver », « Aucun courriel affiché » : la case reste vide (le texte va dans les notes)
    const garde = [];
    if (v.telephone && v.telephone.replace(/\D/g, '').length < 7) { garde.push(`Téléphone : ${v.telephone}`); v.telephone = ''; }
    if (v.site && !/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i.test(v.site)) { garde.push(`Site : ${v.site}`); v.site = ''; }
    if (v.courriel && !lienCourriel(v.courriel)) { garde.push(`Courriel : ${v.courriel}`); v.courriel = ''; }
    if (!v.courriel) v.preuve = v.preuve || '';
    v.priorite = /^[abc]$/i.test(v.priorite || '') ? v.priorite.toUpperCase() : 'B';
    v.ne_pas_contacter = /^oui|^yes/i.test(v.ne_pas_contacter || '');
    v.notes = [v.notes, ...garde].filter(Boolean).join('\n');
    v.cle = nouvelleCle('pr');
    return v;
  }).filter(v => v.entreprise);
  return { prospects, colonnes: Object.keys(index) };
}

export function ouvrirCollageListe() {
  if (!pret()) return;
  const zone = champTexte('La liste', { multiligne: true, rows: 9, spellcheck: 'false', placeholder: 'Entreprise\tMétier\tTéléphone\tSite web\nPlomberie Côté\tPlomberie\t819 555-0142\tplomberiecote.ca' },
    'Copie les lignes d’un tableur (avec la ligne des titres) et colle-les ici. 200 prospects au plus à la fois.', '');
  const apercu = el('p', { class: 'champ__aide', role: 'status' });
  const majApercu = () => {
    const r = lireListe(zone.input.value);
    apercu.textContent = r.erreur || (r.prospects.length
      ? `${pluriel(r.prospects.length, 'prospect reconnu', 'prospects reconnus')}. Colonnes : ${r.colonnes.join(', ')}.`
      : '');
  };
  zone.input.addEventListener('input', majApercu);
  panneauFormulaire({
    titre: 'Coller une liste', sousTitre: 'Des prospects copiés d’un tableur', bouton: 'Ajouter les prospects', chemin: 'prospects/importer',
    corps: [zone.boite, apercu],
    preparer: () => {
      const r = lireListe(zone.input.value);
      if (r.erreur) throw new Invalide(r.erreur, zone.input);
      if (!r.prospects.length) throw new Invalide('Aucun prospect reconnu : colle aussi la ligne des titres.', zone.input);
      if (r.prospects.length > 200) throw new Invalide('200 prospects au plus à la fois : colle la liste en deux fois.', zone.input);
      return { prospects: r.prospects };
    },
    reussite: r => {
      const morceaux = [pluriel(r.ajoutes || 0, 'prospect ajouté', 'prospects ajoutés')];
      if (r.deja) morceaux.push(`${r.deja} déjà là`);
      if (r.refuses && r.refuses.length) morceaux.push(`${r.refuses.length} refusés (${r.refuses[0].entreprise || 'ligne ' + r.refuses[0].rang} : ${r.refuses[0].raison})`);
      return morceaux.join(', ') + '.';
    },
    modifie: () => !!zone.input.value.trim(),
    focus: () => zone.input
  });
}

// Pour le tableau de bord : « 3 prospects à relancer »
export function aRelancer() { return E.prospects ? E.prospects.a_relancer || 0 : 0; }
export const prospectsPourRecherche = () => (E.prospects ? E.prospects.prospects : []);
