// « À faire aujourd'hui » (tableau de bord) : ce qui demande une action, du plus pressé au moins
// pressé, et chaque ligne s'ouvre d'un toucher. Trois marqueurs : Urgent (rouge), Aujourd'hui
// (orange), Bientôt (bleu). Tout vient de ce que le CRM a déjà lu (tableau de bord, argent, équipe,
// prospects) : aucune requête de plus. « Fait » sur un appel ou une demande ne vaut que sur cet
// appareil (7 jours) ; une tâche cochée l'est pour de bon.
import { $, $$, icone, vider, nombre, pluriel, majuscule, date, relatif, heure, ymd, compteARebours, lienTel, lienCourriel,
  urlSure, lire, ecrire, toast, signal, normal } from './outils.js';
import { E } from './etat.js';
import { sessionActuelle } from './api.js';
import { montrer } from './navigation.js';
import { el } from './formes.js';
import { source, etatServeur, reveiller, prenom } from './tableau.js';
import { argent as montant, ouvrirPaiement, ouvrirAbonnement } from './argent.js';
import { mesTaches, finirTache, ouvrirTache } from './equipe.js';
import { voirProspects, ouvrirProspect } from './prospects.js';
import { ouvrirFiche } from './fiche.js';

const PRIOS = { urgent: ['Urgent', 0], aujourdhui: ['Aujourd’hui', 1], bientot: ['Bientôt', 2] };
const MONTRES = 6;                                   // au-delà : « Voir les 3 autres »
const CLE_FAITS = 'uio-crm-afaire-faits';            // { « ap:call_x » : quand } sur cet appareil
const OUVERTES = ['a_contacter', 'contacte', 'rendez_vous'];
const RECHARGER = {
  retell: 'https://dashboard.retellai.com/',
  twilio: 'https://console.twilio.com/us1/billing/manage-billing/billing-overview',
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  render: 'https://dashboard.render.com/'
};
const ui = { tout: false, signature: '' };

// ─── Petits outils ─────────────────────────────────────────────────────────
const moiId = () => ((sessionActuelle() || {}).admin || {}).identifiant || '';
const usd = v => `${nombre(v, 2)} $ US`;
const aujourdhui = () => ymd(new Date());
// Jours entre aujourd'hui (au Québec) et « 2026-11-12 » : 0 aujourd'hui, 1 demain, -1 hier
function ecart(jour) {
  const a = Date.parse(`${aujourdhui()}T12:00:00Z`), b = Date.parse(`${String(jour).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(b) ? null : Math.round((b - a) / 864e5);
}
const pourJour = n => (n === 0 ? 'pour aujourd’hui' : n === 1 ? 'pour demain' : n > 1 ? `pour dans ${n} jours` : n === -1 ? 'prévue hier' : `prévue il y a ${-n} jours`);
const chiffres = t => String(t || '').replace(/\D/g, '').slice(-10);

function faits() {
  let f = {};
  try { f = JSON.parse(lire('localStorage', CLE_FAITS) || '{}') || {}; } catch (e) { f = {}; }
  const limite = Date.now() - 7 * 864e5;
  for (const k of Object.keys(f)) if (!(f[k] > limite)) delete f[k];
  return f;
}
function marquerFait(cle) {
  const f = faits();
  f[cle] = Date.now();
  ecrire('localStorage', CLE_FAITS, JSON.stringify(f));
}

// Va à une carte d'un onglet (et à une ligne dedans), la montre et y met le focus
function allerA(vue, carteId, dedans = '') {
  if (E.vue !== vue) montrer(vue);
  requestAnimationFrame(() => {
    const carte = document.getElementById(carteId);
    if (!carte) return;
    const cible = (dedans && carte.querySelector(dedans)) || carte;
    const doux = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    cible.scrollIntoView({ block: dedans ? 'center' : 'start', behavior: doux });
    const titre = carte.querySelector('h2');
    if (titre) { titre.tabIndex = -1; titre.focus({ preventScroll: true }); }
    if (dedans && cible !== carte) {
      cible.classList.remove('eclat');
      void cible.offsetWidth;                        // l'éclat repart même s'il était déjà là
      cible.classList.add('eclat');
      setTimeout(() => cible.classList.remove('eclat'), 1800);
    }
  });
}

const puceLien = (texte, href, icon = '') => href ? el('a', { class: 'puce', href, ...(/^https:/.test(href) ? { target: '_blank', rel: 'noopener' } : {}) },
  icon ? icone(icon) : null, texte) : null;
const puceBouton = (texte, onclick, focus) => el('button', { class: 'puce', type: 'button', 'data-focus': focus, onclick }, texte);
const puceFait = (cle, quoi) => puceBouton('Fait', () => { marquerFait(cle); toast(`${quoi} : c’est noté sur cet appareil.`); rendreAFaire(true); }, `afait:${cle}`);

// ─── Ce qui presse, source par source ──────────────────────────────────────
function deServeur(L) {
  if (etatServeur() !== 'panne' && !E.reveil) return;
  L.push({ cle: 'serveur', prio: 'urgent', icone: 'i-alerte',
    titre: E.reveil ? 'Réveil du serveur en cours…' : 'Le serveur ne répond pas',
    meta: E.reveil ? 'Ça prend jusqu’à une minute.' : 'Il dort peut-être : les chatbots et le CRM l’attendent.',
    ouvrir: E.reveil ? null : () => reveiller(), titreAction: 'Réveiller le serveur' });
}

function deCredits(L) {
  const appels = source('appels');
  const alerteAppels = appels && appels.disponible && appels.alerte ? appels.alerte : '';
  const c = (E.argent && E.argent.credits) || {}, rt = c.retell || {}, tw = c.twilio || {}, oa = c.openai || {};
  const vers = () => allerA('argent', 'carte-credits');
  const retellEpuise = rt.etat === 'epuise' || /crédit retell épuisé/i.test(alerteAppels);
  if (retellEpuise) {
    L.push({ cle: 'cr:retell', prio: 'urgent', icone: 'i-alerte', titre: 'Crédit Retell épuisé', meta: 'Les appels ne passent plus : recharge le compte Retell.',
      ouvrir: vers, actions: [puceLien('Recharger', RECHARGER.retell, 'i-sortie')] });
  } else if (rt.alerte) {
    L.push({ cle: 'cr:retell', prio: 'aujourdhui', icone: 'i-argent', titre: 'Crédit Retell bas',
      meta: [rt.estime_usd != null ? `Environ ${usd(rt.estime_usd)}` : '', rt.minutes_restantes != null ? `environ ${nombre(rt.minutes_restantes)} min d’appels` : ''].filter(Boolean).join(' · ') || 'Recharge-le avant les prochains appels.',
      ouvrir: vers, actions: [puceLien('Recharger', RECHARGER.retell, 'i-sortie')] });
  }
  if (alerteAppels && !/crédit retell/i.test(alerteAppels)) {
    L.push({ cle: 'cr:appels', prio: 'aujourdhui', icone: 'i-telephone', titre: 'Un appel n’a pas pu être pris', meta: alerteAppels,
      ouvrir: () => allerA('tableau', 'carte-appels'), actions: [puceLien('Retell', urlSure(appels.lien_retell) || RECHARGER.retell, 'i-sortie')] });
  }
  if (tw.alerte) {
    const vide = tw.solde_usd != null && Number(tw.solde_usd) <= 0;
    L.push({ cle: 'cr:twilio', prio: vide ? 'urgent' : 'aujourdhui', icone: vide ? 'i-alerte' : 'i-argent', titre: vide ? 'Crédit Twilio épuisé' : 'Crédit Twilio bas',
      meta: vide ? 'Les appels et les textos ne passent plus : recharge le compte Twilio.'
        : `${tw.solde_usd != null ? `${usd(tw.solde_usd)} : ` : ''}sans recharge, les appels et les textos s’arrêtent.`,
      ouvrir: vers, actions: [puceLien('Recharger', RECHARGER.twilio, 'i-sortie')] });
  }
  if (oa.etat === 'epuise') {
    L.push({ cle: 'cr:openai', prio: 'urgent', icone: 'i-alerte', titre: 'Crédit OpenAI épuisé', meta: 'Le chatbot ne répond plus.',
      ouvrir: vers, actions: [puceLien('Recharger', RECHARGER.openai, 'i-sortie')] });
  } else if (oa.etat === 'cle_refusee') {
    L.push({ cle: 'cr:openai', prio: 'urgent', icone: 'i-alerte', titre: 'Clé OpenAI refusée', meta: 'Le chatbot ne répond plus : remplace la clé dans Render.',
      ouvrir: vers, actions: [puceLien('Render', RECHARGER.render, 'i-sortie')] });
  }
}

function deFactures(L) {
  const a = E.argent;
  if (!a || !Array.isArray(a.echeances)) return;
  for (const f of a.echeances) {
    if (!((f.etat === 'due' || f.etat === 'en_retard') && f.reste > 0)) continue;
    const ab = (a.abonnements || []).find(x => x.id === f.abonnement);
    const c = ab && ab.client ? E.clients.find(x => String(x.client_id) === String(ab.client)) : null;
    const retard = f.etat === 'en_retard';
    const quand = retard ? `en retard de ${-f.jours} j` : f.jours === 0 ? 'due aujourd’hui' : `due depuis ${-f.jours} j`;
    L.push({ cle: `fa:${f.abonnement}:${f.numero}`, prio: retard ? 'urgent' : 'aujourdhui', icone: 'i-argent',
      titre: `${f.nom || (ab && ab.nom) || 'Un client'} · facture ${f.numero}`, meta: `${montant(f.reste)} ${quand}`,
      ouvrir: () => (c ? ouvrirFiche(c, { section: 'factures' }) : ouvrirAbonnement(f.abonnement)),
      titreAction: c ? 'Ouvrir sa fiche' : 'Ouvrir l’abonnement',
      actions: [puceBouton('Payée', () => ouvrirPaiement({ abonnement: f.abonnement, facture: f.numero }), `afp:${f.abonnement}:${f.numero}`)] });
  }
}

// Les appels où quelqu'un attend qu'on le rappelle (le serveur les donne depuis le 2026-11-09)
function deRappels(L, F) {
  const s = source('appels');
  if (!s || !s.disponible || !Array.isArray(s.a_rappeler)) return;
  for (const r of s.a_rappeler) {
    const cle = `ap:${r.id || r.debut}`;
    if (F[cle]) continue;
    const quand = date(r.debut);
    // « Denis, fuite d’eau… rappeler avant 17 h » : le prénom est déjà dans le titre, le moment souvent dans la phrase
    let quoi = String(r.quoi || '').trim();
    if (r.prenom && normal(quoi).startsWith(normal(r.prenom))) quoi = majuscule(quoi.slice(String(r.prenom).length).replace(/^[\s,:;–-]+/u, ''));
    const moment = r.moment && !normal(quoi).includes(normal(r.moment)) ? `rappel souhaité : ${r.moment}` : '';
    L.push({ cle, prio: r.urgent ? 'urgent' : 'aujourdhui', icone: 'i-telephone',
      titre: `Rappeler ${r.prenom || r.de || 'l’appelant'}`,
      meta: [quoi, moment, r.prenom ? String(r.de || '').replace(/ /g, '\u00a0') : '', quand ? `appel ${relatif(quand)}` : ''].filter(Boolean).join(' · '),
      ouvrir: urlSure(r.lien) ? { href: urlSure(r.lien) } : null, titreAction: 'Écouter l’appel dans Retell',
      actions: [puceLien('Appeler', lienTel(r.de), 'i-telephone'), puceFait(cle, 'Rappel')] });
  }
}

// Mes tâches qui pressent (urgentes, en retard, pour aujourd'hui ou les 2 prochains jours) ; le reste est compté
function deTaches(L) {
  if (!E.equipe) return 0;
  const moi = moiId();
  let autres = 0;
  for (const t of mesTaches()) {
    const n = t.echeance ? ecart(t.echeance) : null;
    let prio = '';
    if (t.priorite === 'urgente' || t.en_retard > 0 || (n != null && n < 0)) prio = 'urgent';
    else if (n === 0) prio = 'aujourdhui';
    else if (n != null && n <= 2) prio = 'bientot';
    if (!prio) { autres++; continue; }
    // La pastille dit déjà « Urgent » : la ligne dit pourquoi (en retard, pour quand, de qui)
    const meta = [t.en_retard > 0 ? `en retard de ${t.en_retard} j` : n != null ? pourJour(n) : '',
      t.pour === 'tous' ? 'pour tout le monde' : '', t.de && t.de !== moi ? `de ${prenom(t.de_nom) || t.de}` : ''].filter(Boolean);
    if (!meta.length) meta.push(t.priorite === 'urgente' ? 'marquée urgente' : 'ta tâche');
    L.push({ cle: `ta:${t.id}`, prio, titre: t.titre, coche: () => finirTache(t.id), meta: majuscule(meta.join(' · ')),
      ouvrir: () => ouvrirTache(t.id), titreAction: 'Ouvrir la tâche' });
  }
  return autres;
}

function deAudits(L) {
  const s = source('rendez_vous');
  if (!s || !s.disponible) return;
  const m = new Date(), auj = ymd(m);
  const agenda = typeof s.lien === 'string' && s.lien.startsWith('https://calendar.google.com/') ? s.lien : 'https://calendar.google.com/';
  for (const a of s.prochains || []) {
    const d = date(a.debut);
    if (!d || ymd(d) !== auj || d.getTime() < m.getTime() - 60 * 60e3) continue;
    L.push({ cle: `au:${a.debut}`, prio: 'aujourdhui', icone: 'i-horloge', titre: `Audit avec ${a.nom || 'un client potentiel'} à ${heure(d)}`,
      meta: d <= m ? 'En cours' : compteARebours(d, m), ouvrir: { href: agenda }, titreAction: 'Ouvrir l’agenda',
      actions: [puceLien('Écrire', lienCourriel(a.courriel), 'i-courriel')] });
  }
}

// Les demandes du chatbot des 3 derniers jours qui ne sont pas encore un prospect
function dejaProspect(d, prospects) {
  const nom = normal(d.entreprise || d.nom || ''), tel = chiffres(d.telephone), courriel = String(d.courriel || '').trim().toLowerCase();
  return prospects.some(p => (tel && tel.length === 10 && chiffres(p.telephone) === tel)
    || (courriel && String(p.courriel || '').trim().toLowerCase() === courriel)
    || (nom && normal(p.entreprise || '') === nom));
}
function deDemandes(L, F) {
  const s = source('demandes');
  if (!s || !s.disponible || !Array.isArray(s.dernieres)) return;
  const limite = Date.now() - 72 * 3600e3;
  const prospects = (E.prospects && E.prospects.prospects) || [];
  for (const d of s.dernieres) {
    const quand = date(d.date);
    if (!quand || quand.getTime() < limite) continue;
    const cle = `dm:${d.id || d.date + d.nom}`;
    if (F[cle] || dejaProspect(d, prospects)) continue;
    L.push({ cle, prio: 'aujourdhui', icone: 'i-mot', titre: `Répondre à ${d.nom || 'un visiteur'}`,
      meta: [d.entreprise, d.besoin, d.moment_rappel ? `rappel souhaité : ${d.moment_rappel}` : '', `demande au chatbot ${relatif(quand)}`].filter(Boolean).join(' · '),
      ouvrir: () => allerA('tableau', 'carte-demandes', d.id ? `[data-demande="${CSS.escape(d.id)}"]` : ''), titreAction: 'Voir la demande',
      actions: [puceLien('Appeler', lienTel(d.telephone), 'i-telephone'), puceLien('Écrire', lienCourriel(d.courriel), 'i-courriel'), puceFait(cle, 'Demande')] });
  }
}

// Les prospects à relancer (les miens, ou ceux de personne) : 3 lignes au plus, puis une pour le reste
function deProspects(L) {
  const P = E.prospects;
  if (!P || !Array.isArray(P.prospects)) return;
  const moi = moiId();
  const liste = P.prospects.filter(p => p.jours_retard != null && p.jours_retard >= 0 && !p.ne_pas_contacter
    && OUVERTES.includes(p.etape) && (!p.responsable || p.responsable === moi)).sort((a, b) => b.jours_retard - a.jours_retard);
  for (const p of liste.slice(0, 3)) {
    L.push({ cle: `pr:${p.id}`, prio: 'aujourdhui', icone: 'i-clients', titre: `Relancer ${p.entreprise}`,
      meta: [p.prochaine_action, p.jours_retard === 0 ? 'prévu aujourd’hui' : p.jours_retard === 1 ? 'prévu hier' : `prévu il y a ${p.jours_retard} jours`].filter(Boolean).join(' · '),
      ouvrir: () => ouvrirProspect(p.id), titreAction: 'Noter un contact',
      actions: [puceLien('Appeler', lienTel(p.telephone), 'i-telephone')] });
  }
  if (liste.length > 3) {
    L.push({ cle: 'pr:autres', prio: 'aujourdhui', icone: 'i-clients', titre: `${pluriel(liste.length - 3, 'autre prospect', 'autres prospects')} à relancer`,
      meta: 'La liste des relances, la plus en retard d’abord', ouvrir: () => voirProspects({ filtre: 'relancer' }), titreAction: 'Voir les relances' });
  }
}

// Le partage 50/50 : ce que j'ai à envoyer
function dePartage(L) {
  const a = E.argent, p = a && a.partage;
  if (!p || !Array.isArray(p.suggestions)) return;
  const nomDe = id => (id === 'agence' ? 'l’agence' : prenom((a.noms || {})[id]) || id);
  for (const s of p.suggestions) {
    if (s.de !== a.moi) continue;
    L.push({ cle: `vi:${s.a}:${s.montant}`, prio: 'bientot', icone: 'i-argent', titre: `Envoyer ${montant(s.montant)} à ${nomDe(s.a)}`,
      meta: 'Le partage 50/50, par virement Interac', ouvrir: () => allerA('argent', 'carte-partage'), titreAction: 'Voir le partage' });
  }
}

// Les minutes au-delà du forfait, quand la prochaine facture approche (3 jours) et ne les a pas encore
function deMinutes(L) {
  const a = E.argent, m = a && a.minutes;
  if (!m || !m.disponible) return;
  for (const c of m.clients || []) {
    if (!(c.minutes_en_plus > 0 && c.a_facturer > 0)) continue;
    const ab = (a.abonnements || []).find(x => x.id === c.abonnement);
    const f = ab && (ab.factures || []).find(x => x.numero === c.facture_suivante);
    if (!f || f.jours == null || f.jours > 3) continue;
    const deja = (f.ajouts || []).find(x => /^minutes en plus/i.test(x.quoi));
    if (deja && Math.abs(deja.montant - c.a_facturer) < 0.005) continue;
    L.push({ cle: `mi:${c.abonnement}`, prio: 'bientot', icone: 'i-horloge', titre: `Facturer ${pluriel(c.minutes_en_plus, 'minute', 'minutes')} en plus à ${c.nom}`,
      meta: `${montant(c.a_facturer)} à ajouter à la facture ${f.numero}`, ouvrir: () => allerA('argent', 'carte-minutes'), titreAction: 'Voir les minutes' });
  }
}

// ─── Le dessin ─────────────────────────────────────────────────────────────
async function cocher(bouton, x) {
  if (bouton.getAttribute('aria-busy')) return;
  const li = bouton.closest('li');
  bouton.setAttribute('aria-busy', 'true');
  bouton.setAttribute('aria-checked', 'true');
  if (li) li.classList.add('afaire__ligne--faite');
  try {
    await x.coche();
    toast('Tâche faite.');
  } catch (e) {
    bouton.removeAttribute('aria-busy');
    bouton.setAttribute('aria-checked', 'false');
    if (li) li.classList.remove('afaire__ligne--faite');
    if (e.statut !== 401) toast(e.message || 'Ça n’a pas marché. Réessaie.', true);
  }
}

function ligne(x) {
  const contenu = [
    el('span', { class: 'afaire__texte' }, el('span', { class: 'afaire__titre' }, x.titre), x.meta ? el('span', { class: 'afaire__meta' }, x.meta) : null),
    el('span', { class: 'afaire__prio' }, PRIOS[x.prio][0])];
  const focus = `af:${x.cle}`;
  let ouvrir;
  if (x.ouvrir && x.ouvrir.href) {
    const dehors = /^https:/.test(x.ouvrir.href);
    ouvrir = el('a', { class: 'afaire__ouvrir', href: x.ouvrir.href, title: x.titreAction || null, 'data-focus': focus, ...(dehors ? { target: '_blank', rel: 'noopener' } : {}) }, contenu);
  } else if (typeof x.ouvrir === 'function') {
    ouvrir = el('button', { class: 'afaire__ouvrir', type: 'button', title: x.titreAction || null, 'data-focus': focus, onclick: x.ouvrir }, contenu);
  } else ouvrir = el('div', { class: 'afaire__ouvrir afaire__ouvrir--fixe' }, contenu);
  const tete = x.coche
    ? el('button', { class: 'tache__case afaire__case', type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': `Faite : ${x.titre}`,
      'data-focus': `afc:${x.cle}`, onclick: ev => cocher(ev.currentTarget, x) }, icone('i-ok'))
    : el('span', { class: 'afaire__icone', 'aria-hidden': 'true' }, icone(x.icone || 'i-ok'));
  const actions = (x.actions || []).filter(Boolean);
  return el('li', { class: 'afaire__ligne', 'data-prio': x.prio }, tete,
    el('div', { class: 'afaire__corps' }, ouvrir, actions.length ? el('div', { class: 'afaire__actions' }, actions) : null));
}

export function rendreAFaire(force = false) {
  const boite = $('#afaire');
  if (!boite || !sessionActuelle()) return;
  const F = faits();
  const L = [];
  deServeur(L); deCredits(L); deFactures(L); deRappels(L, F);
  const autres = deTaches(L);
  deAudits(L); deDemandes(L, F); deProspects(L); dePartage(L); deMinutes(L);
  L.forEach((x, i) => { x.i = i; });
  L.sort((a, b) => PRIOS[a.prio][1] - PRIOS[b.prio][1] || a.i - b.i);

  const urgents = L.filter(x => x.prio === 'urgent').length;
  signal('carte-afaire', urgents ? 'alerte' : L.some(x => x.prio === 'aujourdhui') ? 'attente' : '');
  const compte = $('#afaire-compte');
  if (compte) {
    compte.hidden = !L.length;
    compte.textContent = urgents ? `${L.length} · ${urgents} urgent${urgents > 1 ? 's' : ''}` : String(L.length);
  }
  const enLecture = [!E.tableau && !E.tableauErreur, !E.argent && !E.argentErreur, !E.equipe && !E.equipeErreur, !E.prospects && !E.prospectsErreur].some(Boolean);

  // Redessinée toutes les 15 s : rien ne bouge si rien n'a changé (un clic en cours n'est jamais perdu)
  const signature = JSON.stringify([L.map(x => [x.cle, x.prio, x.titre, x.meta]), autres, enLecture, ui.tout]);
  if (!force && signature === ui.signature && boite.childElementCount) return;
  ui.signature = signature;

  const a = document.activeElement;
  const cleFocus = a && a.dataset && boite.contains(a) ? a.dataset.focus || '' : '';
  const blocs = [];
  if (!L.length) {
    blocs.push(enLecture ? el('p', { class: 'vide' }, 'Lecture en cours…')
      : el('p', { class: 'afaire__rien' }, icone('i-ok'), el('span', null, el('b', null, 'Rien qui presse aujourd’hui.'), ' Les tâches, les factures, les rappels et les relances arrivent ici quand c’est le moment.')));
  } else {
    const montres = ui.tout || L.length <= MONTRES + 1 ? L : L.slice(0, MONTRES);
    blocs.push(el('ul', { class: 'afaire', 'aria-label': 'À faire, du plus pressé au moins pressé' }, montres.map(ligne)));
    if (montres.length < L.length || ui.tout && L.length > MONTRES + 1) {
      blocs.push(el('button', { class: 'lien-texte afaire__plus', type: 'button', 'data-focus': 'af:plus', 'aria-expanded': String(ui.tout),
        onclick: () => { ui.tout = !ui.tout; rendreAFaire(true); } }, ui.tout ? 'Voir moins' : `Voir ${L.length - MONTRES === 1 ? 'l’autre' : `les ${L.length - MONTRES} autres`}`));
    }
  }
  const pied = [];
  if (autres) {
    pied.push(L.length ? 'Et ' : '', pluriel(autres, 'tâche sans date proche', 'tâches sans date proche'), ' pour toi : ',
      el('button', { class: 'lien-texte', type: 'button', 'data-focus': 'af:equipe', onclick: () => montrer('equipe') }, 'voir l’équipe'), '.');
  }
  if (L.length && enLecture) pied.push(pied.length ? ' ' : '', 'Lecture du reste…');
  if (pied.length) blocs.push(el('p', { class: 'note' }, pied));
  vider(boite, blocs);
  if (cleFocus) {
    const n = $$('[data-focus]', boite).find(b => b.dataset.focus === cleFocus);
    if (n) n.focus({ preventScroll: true });
  }
}
