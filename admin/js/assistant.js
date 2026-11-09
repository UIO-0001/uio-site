// L'assistant Claude du CRM : la bulle en bas à droite (ou la touche A).
// On lui écrit « Mobilo nous paie 60 $ par mois depuis septembre » : il lit le CRM avec tes droits
// et PROPOSE le changement sur une carte. Rien ne change avant « Confirmer » (le serveur l'impose),
// et « Défaire » remet tout comme avant pendant 30 minutes.
// La conversation reste sur cet appareil (localStorage, 7 jours) : le serveur ne garde que le coût.
import { $, icone, vider, lire, ecrire, toast, nombre } from './outils.js';
import { el } from './formes.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';

const GARDE_JOURS = 7, MESSAGES_MAX = 40, ENVOYES_MAX = 24;
const SUGGESTIONS = [
  'Quelles factures sont dues ou en retard ?',
  'Combien on a gagné ce mois-ci, et combien il reste à encaisser ?',
  'Ajoute-moi une tâche pour demain : rappeler le dernier appel manqué',
  'Mobilo nous paie 60 $ par mois depuis septembre'
];
const LIBELLES = { mensuel: 'Prix par mois', depart: 'Frais de départ', debut: 'Début', fin: 'Fin', forfait: 'Forfait', nom: 'Nom',
  minutes: 'Minutes incluses', blocs: 'Blocs de 250 min', credit_depart: 'Frais crédités', agents: 'Agents', notes: 'Notes',
  montant: 'Montant', date: 'Date', recu_par: 'Reçu par', payeur: 'Payé par', quoi: 'Quoi', titre: 'Titre', details: 'Détails',
  pour: 'Pour', statut: 'Statut', priorite: 'Priorité', echeance: 'Échéance', etape: 'Étape', responsable: 'Qui s’en occupe',
  prochaine_action: 'Prochaine action', prochaine_date: 'Date de la prochaine action', notes_internes: 'Notes internes',
  contact: 'Personne-contact', courriel: 'Courriel', telephone: 'Téléphone', adresse: 'Adresse', site: 'Site', metier: 'Métier',
  langue: 'Langue', depuis: 'Depuis', rapport_auto: 'Rapport par courriel' };
const ARGENT = new Set(['mensuel', 'depart', 'montant', 'credit_usd', 'montant_usd']);
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// « 60.00 » → « 60,00 $ », « 2026-09-01 » → « 1er sept. 2026 »
function valeur(champ, v) {
  const t = String(v == null ? '' : v);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (d) return `${Number(d[3]) === 1 ? '1er' : Number(d[3])} ${MOIS[Number(d[2]) - 1]} ${d[1]}`;
  if (ARGENT.has(champ) && /^-?\d+([.,]\d+)?$/.test(t)) return `${nombre(Number(t.replace(',', '.')), 2)} ${champ.endsWith('usd') ? '$ US' : '$'}`;
  return t;
}
const ETATS = { attente: 'À confirmer', fait: 'Fait', defait: 'Défait', erreur: 'Refusé', ignore: 'Ignoré', expire: 'Expiré' };
const ui = { ouvert: false, etat: null, conv: [], job: null, minuterie: 0, retour: null, envoi: false };

// ─── La conversation, sur l'appareil ───────────────────────────────────────
const cleConv = () => { const s = sessionActuelle(); return s ? `uio-assistant-${s.admin.identifiant}` : ''; };
function relireConv() {
  ui.conv = [];
  try {
    const d = JSON.parse(lire('localStorage', cleConv()) || 'null');
    if (d && Array.isArray(d.messages) && Date.now() - d.t < GARDE_JOURS * 864e5) ui.conv = d.messages.slice(-MESSAGES_MAX);
  } catch (e) { /* illisible : on repart à zéro */ }
}
function garderConv() {
  const cle = cleConv();
  if (!cle) return;
  ecrire('localStorage', cle, ui.conv.length ? JSON.stringify({ t: Date.now(), messages: ui.conv.slice(-MESSAGES_MAX) }) : null);
}

// Ce que Claude relit de la conversation : les textes, et ce qui est arrivé à chaque proposition
function pourLeServeur() {
  return ui.conv.slice(-ENVOYES_MAX).map(m => {
    if (m.role === 'user') return { role: 'user', texte: m.texte };
    const suites = (m.propositions || []).map(p => `[Proposition « ${p.resume} » : ${(ETATS[p.etat] || p.etat).toLowerCase()}${p.erreur ? ` (${p.erreur})` : ''}]`);
    return { role: 'assistant', texte: [m.texte || (m.erreur ? `(Erreur : ${m.erreur})` : ''), ...suites].filter(Boolean).join('\n') };
  }).filter(m => m.texte);
}

const pageOuverte = () => {
  const noms = { tableau: 'Tableau de bord', clients: 'Clients', argent: 'Argent', equipe: 'Équipe', reglages: 'Réglages' };
  const panneau = !$('#panneau').hidden && $('#panneau-titre') ? $('#panneau-titre').textContent.trim() : '';
  return [noms[E.vue] || E.vue, panneau ? `fiche ouverte : ${panneau}` : ''].filter(Boolean).join(' · ');
};

// ─── Ouvrir et fermer ──────────────────────────────────────────────────────
export const assistantOuvert = () => ui.ouvert;
export function ouvrirAssistant(question = '') {
  if (!sessionActuelle()) return;
  if (!ui.ouvert) {
    ui.retour = document.activeElement;
    ui.ouvert = true;
    relireConv();
    $('#assistant').hidden = false;
    $('#assistant-bulle').setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('avec-assistant');
    requestAnimationFrame(() => $('#assistant').classList.add('ouvert'));
    rendre();
    chargerEtat();
  }
  const champ = $('#assistant-champ');
  if (question) { champ.value = question; ajuster(); }
  champ.focus();
}
export function fermerAssistant() {
  if (!ui.ouvert) return;
  ui.ouvert = false;
  const a = $('#assistant');
  a.classList.remove('ouvert');
  a.hidden = true;
  $('#assistant-bulle').setAttribute('aria-expanded', 'false');
  document.documentElement.classList.remove('avec-assistant');
  if (ui.retour && document.contains(ui.retour)) ui.retour.focus({ preventScroll: true });
}
// Au verrouillage : tout s'efface de l'écran (la conversation reste sur l'appareil, sans session pour la lire)
export function viderAssistant() {
  fermerAssistant();
  clearTimeout(ui.minuterie);
  Object.assign(ui, { etat: null, conv: [], job: null, envoi: false });
  const fil = $('#assistant-fil');
  if (fil) vider(fil);
}

async function chargerEtat() {
  try { ui.etat = await api('/portal/admin/assistant'); }
  catch (e) { ui.etat = { erreur: e.statut === 404 ? 'pas-encore' : e.message }; }
  rendreTete();
  rendreReglagesAssistant();
  rendrePied();
}

// ─── Dessiner ──────────────────────────────────────────────────────────────
function rendreTete() {
  const s = $('#assistant-sous-titre');
  if (!s) return;
  const x = ui.etat;
  if (!x) s.textContent = 'Lecture…';
  else if (x.erreur) s.textContent = x.erreur === 'pas-encore' ? 'Le serveur doit d’abord recevoir sa mise à jour.' : x.erreur;
  else if (!x.pret) s.textContent = 'Attend sa clé';
  else s.textContent = `${x.modele_nom} · ${dollarsUS(x.depense_usd)} sur ${dollarsUS(x.plafond_usd, 0)} ce mois`;
}
const dollarsUS = (v, d = 2) => `${nombre(v || 0, d)} $ US`;
const cents = v => (v < 0.01 ? '< 1 ¢' : v < 1 ? `≈ ${Math.round(v * 100)} ¢` : `≈ ${nombre(v, 2)} $`);

function rendre() {
  const fil = $('#assistant-fil');
  if (!fil) return;
  const morceaux = [];
  if (!ui.conv.length) {
    morceaux.push(el('div', { class: 'assistant__vide' },
      el('p', { class: 'assistant__bonjour' }, 'Demande-moi quelque chose sur le CRM, ou un changement.'),
      el('p', { class: 'note' }, 'Je lis avec tes droits. Je ne change rien sans ton « Confirmer », et je ne touche jamais aux comptes, aux mots de passe ni aux clés.'),
      el('div', { class: 'assistant__suggestions' }, SUGGESTIONS.map(t =>
        el('button', { class: 'puce', type: 'button', onclick: () => ouvrirAssistant(t) }, t)))));
  }
  ui.conv.forEach((m, i) => morceaux.push(m.role === 'user' ? bulleMoi(m) : bulleClaude(m, i)));
  if (ui.job) morceaux.push(el('div', { class: 'assistant__travail', role: 'status' },
    el('span', { class: 'roue roue--petite', 'aria-hidden': 'true' }), el('span', null, ui.job.etape || 'Je réfléchis…')));
  vider(fil, morceaux);
  fil.scrollTop = fil.scrollHeight;
  rendrePied();
}

const bulleMoi = m => el('div', { class: 'assistant__moi' }, el('p', null, m.texte));

function bulleClaude(m, i) {
  return el('div', { class: 'assistant__claude' },
    m.texte ? el('div', { class: 'assistant__texte' }, paragraphes(m.texte)) : null,
    m.erreur ? el('p', { class: 'erreur', role: 'alert' }, m.erreur) : null,
    (m.propositions || []).map(p => carte(p, i)),
    m.cout != null ? el('p', { class: 'assistant__cout' }, cents(m.cout)) : null);
}

// Le texte de Claude : des paragraphes et des listes simples, jamais du HTML
function paragraphes(texte) {
  const blocs = String(texte).replace(/\r/g, '').split(/\n{2,}/);
  return blocs.map(b => {
    const lignes = b.split('\n');
    if (lignes.every(l => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
      return el('ul', null, lignes.map(l => el('li', null, gras(l.replace(/^\s*([-•*]|\d+[.)])\s+/, '')))));
    }
    return el('p', null, lignes.flatMap((l, j) => (j ? [el('br'), ...gras(l)] : gras(l))));
  });
}
// **gras** seulement
const gras = t => String(t).split(/\*\*(.+?)\*\*/g).map((x, j) => (j % 2 ? el('b', null, x) : x.replace(/^#+\s*/, '')));

function carte(p, i) {
  const etat = p.etat === 'attente' && p.expire_le && Date.now() > p.expire_le ? 'expire' : p.etat;
  const boutons = [];
  if (etat === 'attente') {
    boutons.push(el('button', { class: 'btn btn--petit', type: 'button', onclick: e => confirmer(p, i, e.currentTarget) }, icone('i-ok'), 'Confirmer'));
    boutons.push(el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { p.etat = 'ignore'; garderConv(); rendre(); } }, 'Ignorer'));
  } else if (etat === 'fait' && p.defaire && Date.now() < (p.defaire_jusqua || 0)) {
    boutons.push(el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: e => defaire(p, i, e.currentTarget) }, icone('i-retour'), 'Défaire'));
  } else if (etat === 'erreur') {
    boutons.push(el('button', { class: 'btn btn--contour btn--petit', type: 'button',
      onclick: () => envoyer(`Ta proposition « ${p.resume} » a été refusée par le serveur : ${p.erreur}. Corrige-la.`) }, 'Demander une correction'));
  }
  return el('article', { class: `proposition proposition--${etat}`, 'aria-label': `Proposition : ${p.resume}` },
    el('div', { class: 'proposition__tete' },
      el('b', null, p.resume),
      el('span', { class: `badge${etat === 'fait' ? '' : etat === 'erreur' ? ' badge--alerte' : etat === 'attente' ? ' badge--attente' : ' badge--neutre'}` }, ETATS[etat] || etat)),
    p.avant_apres && p.avant_apres.length ? el('dl', { class: 'proposition__champs' }, p.avant_apres.flatMap(x => [
      el('dt', null, LIBELLES[x.champ] || x.champ.replace(/_/g, ' ')),
      el('dd', null, el('s', null, valeur(x.champ, x.avant)), el('span', { 'aria-hidden': 'true' }, ' → '), el('span', { class: 'sr' }, ' devient '), el('b', null, valeur(x.champ, x.apres)))])) : null,
    p.details && p.details.length ? el('ul', { class: 'proposition__details' }, p.details.map(d => el('li', null, d))) : null,
    p.erreur ? el('p', { class: 'erreur', role: 'alert' }, p.erreur) : null,
    boutons.length ? el('div', { class: 'proposition__boutons' }, boutons) : null);
}

function rendrePied() {
  const champ = $('#assistant-champ'), bouton = $('#assistant-envoyer'), note = $('#assistant-note');
  if (!champ) return;
  const x = ui.etat;
  const bloque = !!(x && (x.erreur || !x.pret));
  champ.disabled = bloque;
  bouton.disabled = bloque || !!ui.job || ui.envoi;
  champ.placeholder = bloque ? 'L’assistant n’est pas encore prêt' : 'Écris ta demande…';
  if (x && !x.erreur && !x.pret) {
    vider(note, 'L’assistant attend sa clé : ajoute ', el('code', null, 'ANTHROPIC_API_KEY'), ' dans Render (service uio-backend → Environment).');
    note.hidden = false;
  } else note.hidden = true;
}

// ─── Envoyer, suivre, confirmer ────────────────────────────────────────────
async function envoyer(texte) {
  texte = String(texte || '').trim();
  if (!texte || ui.job || ui.envoi) return;
  ui.envoi = true;
  ui.conv.push({ role: 'user', texte: texte.slice(0, 4000) });
  garderConv();
  $('#assistant-champ').value = '';
  ajuster();
  ui.job = { etape: 'Je réfléchis…' };
  rendre();
  try {
    const r = await api('/portal/admin/assistant/demander', { methode: 'POST', delai: 60000,
      corps: { messages: pourLeServeur(), page: pageOuverte() } });
    ui.job = { id: r.job, etape: 'Je réfléchis…', debut: Date.now() };
    suivre();
  } catch (e) {
    ui.job = null;
    ui.conv.push({ role: 'assistant', erreur: e.message });
    garderConv();
    if (e.code === 'sans_cle' || e.code === 'plafond') chargerEtat();
  } finally {
    ui.envoi = false;
    rendre();
  }
}

function suivre() {
  clearTimeout(ui.minuterie);
  ui.minuterie = setTimeout(async () => {
    if (!ui.job || !sessionActuelle()) return;
    try {
      const d = await api(`/portal/admin/assistant/job/${encodeURIComponent(ui.job.id)}`, { delai: 20000 });
      if (d.etat === 'en_cours' && Date.now() - ui.job.debut < 5 * 60e3) {
        const etape = (d.etapes || []).slice(-1)[0];
        if (etape && etape !== ui.job.etape) { ui.job.etape = etape + '…'; rendre(); }
        return suivre();
      }
      ui.job = null;
      const maintenant = Date.now();
      ui.conv.push({ role: 'assistant', texte: d.texte || '', erreur: d.etat === 'erreur' ? d.erreur : (d.etat === 'en_cours' ? 'L’assistant met trop de temps. Réessaie.' : ''),
        cout: d.cout_usd, propositions: (d.propositions || []).map(p => ({ ...p, expire_le: maintenant + (p.expire_dans || 0) * 1000 })) });
      garderConv();
      rendre();
      chargerEtat();
      if (!ui.ouvert) toast('L’assistant a répondu.');
    } catch (e) {
      if (e.statut === 404 || e.statut === 401) { ui.job = null; ui.conv.push({ role: 'assistant', erreur: e.message }); garderConv(); rendre(); return; }
      suivre();                                    // réseau : on réessaie
    }
  }, 1200);
}

async function confirmer(p, i, bouton) {
  bouton.disabled = true;
  try {
    const r = await api('/portal/admin/assistant/confirmer', { methode: 'POST', corps: { proposition: p.id } });
    Object.assign(p, r.proposition, { erreur: '', defaire_jusqua: Date.now() + 30 * 60e3 });
    toast('C’est fait.');
    document.dispatchEvent(new CustomEvent('uio:assistant'));
  } catch (e) {
    if (e.statut === 400 && /expir|n’existe plus|n'existe plus/.test(e.message)) p.etat = 'expire';
    else if (e.statut === 400) p.etat = 'erreur';
    p.erreur = e.message;
  }
  garderConv();
  rendre();
}

async function defaire(p, i, bouton) {
  bouton.disabled = true;
  try {
    const r = await api('/portal/admin/assistant/defaire', { methode: 'POST', corps: { proposition: p.id } });
    Object.assign(p, r.proposition, { erreur: '', defaire: false });
    toast('C’est défait : tout est comme avant.');
    document.dispatchEvent(new CustomEvent('uio:assistant'));
  } catch (e) { p.erreur = e.message; p.defaire = false; }
  garderConv();
  rendre();
}

function nouvelleConversation() {
  if (ui.job) return;
  ui.conv = [];
  garderConv();
  rendre();
  $('#assistant-champ').focus();
}

function ajuster() {
  const c = $('#assistant-champ');
  c.style.height = 'auto';
  c.style.height = Math.min(c.scrollHeight, 160) + 'px';
}

// ─── Réglages → Brancher mon Claude : la carte de l'assistant ──────────────
export async function chargerReglagesAssistant() {
  if (!ui.etat || Date.now() - (ui.etatLu || 0) > 30e3) {
    ui.etatLu = Date.now();
    await chargerEtat();
  } else rendreReglagesAssistant();
}

export function rendreReglagesAssistant() {
  const boite = $('#assistant-reglages');
  if (!boite) return;
  const x = ui.etat;
  if (!x) return vider(boite, el('p', { class: 'note' }, 'Lecture…'));
  if (x.erreur) return vider(boite, el('p', { class: 'note' }, x.erreur === 'pas-encore' ? 'Bientôt : le serveur doit d’abord recevoir sa mise à jour.' : x.erreur));
  const part = Math.min(100, Math.round(100 * (x.depense_usd || 0) / (x.plafond_usd || 1)));
  const modele = el('select', { id: 'assistant-modele', 'aria-label': 'Modèle' },
    x.modeles.map(m => { const o = el('option', { value: m.id }, `${m.nom} (${nombre(m.entree, 0)} $ / ${nombre(m.sortie, 0)} $ US par million de jetons)`); if (m.id === x.modele) o.selected = true; return o; }));
  const plafond = el('input', { id: 'assistant-plafond', type: 'number', min: 1, max: x.plafond_max, step: 1, inputmode: 'decimal', value: String(Math.round(x.plafond_usd)) });
  const enregistrer = el('button', { class: 'btn btn--petit', type: 'button', onclick: async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      ui.etat = await api('/portal/admin/assistant/reglages', { methode: 'POST', corps: { modele: modele.value, plafond_usd: plafond.value } });
      toast('Réglages de l’assistant enregistrés.');
      rendreTete(); rendreReglagesAssistant();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  } }, 'Enregistrer');
  vider(boite,
    el('p', { class: 'claude__intro' }, x.pret
      ? 'La bulle en bas à droite (ou la touche A). Elle lit le CRM avec tes droits et propose les changements : rien ne bouge avant ton « Confirmer ». Une seule clé d’API, celle de l’agence, pour vous deux.'
      : 'La bulle est prête, mais elle attend sa clé : ajoute ANTHROPIC_API_KEY dans Render (service uio-backend → Environment). Le serveur redémarre tout seul.'),
    el('div', { class: 'assistant-jauge', role: 'img', 'aria-label': `${dollarsUS(x.depense_usd)} dépensés sur ${dollarsUS(x.plafond_usd, 0)} ce mois` },
      el('div', { class: 'assistant-jauge__barre' }, el('i', { style: `width:${part}%` })),
      el('p', null, el('b', null, dollarsUS(x.depense_usd)), ` sur ${dollarsUS(x.plafond_usd, 0)} ce mois`)),
    x.par_personne.length ? el('ul', { class: 'assistant-qui' }, x.par_personne.map(p => el('li', null, el('span', null, p.nom), el('b', null, dollarsUS(p.usd))))) : el('p', { class: 'note' }, 'Rien de dépensé ce mois-ci.'),
    el('div', { class: 'assistant-champs' },
      el('label', { class: 'champ' }, el('span', null, 'Modèle'), modele),
      el('label', { class: 'champ' }, el('span', null, 'Plafond par mois ($ US, pour vous deux)'), plafond)),
    el('div', { class: 'carte__pied' }, enregistrer),
    el('p', { class: 'note' }, 'La conversation reste sur ton appareil (7 jours, ou « Nouvelle conversation ») : le serveur ne garde que le coût de chaque réponse. Chaque changement va dans l’Historique avec « via l’assistant ».'));
}

// ─── Brancher ──────────────────────────────────────────────────────────────
export function brancherAssistant() {
  $('#assistant-bulle').addEventListener('click', () => (ui.ouvert ? fermerAssistant() : ouvrirAssistant()));
  $('#assistant-fermer').addEventListener('click', fermerAssistant);
  $('#assistant-nouveau').addEventListener('click', nouvelleConversation);
  const champ = $('#assistant-champ');
  champ.addEventListener('input', ajuster);
  champ.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); envoyer(champ.value); }
  });
  $('#assistant-formulaire').addEventListener('submit', e => { e.preventDefault(); envoyer(champ.value); });
}
