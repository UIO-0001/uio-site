// « En cours maintenant » (onglet Équipe) : ce que chaque associé et son Claude font en ce
// moment, pour ne jamais travailler deux fois sur la même chose. Avant de commencer, chaque
// Claude lit ce tableau et réserve son travail (quoi, où, sur quelle branche) ; il donne des
// nouvelles, puis il libère le travail avec son récap. Le serveur refuse une réservation qui
// croise celle d'un autre. Ici, on voit tout en direct (relu toutes les 20 s), on écrit un mot à
// l'autre Claude, on réserve soi-même (« Je m'en occupe ») et on libère un travail périmé.
import { $, icone, vider, majuscule, date, relatif, heure, toast } from './outils.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { depliant } from './ui.js';
import { prenom } from './tableau.js';
import { el, Invalide, nouvelleCle, badge, confirmations, champTexte, formulaireEnLigne, panneauFormulaire } from './formes.js';

export const DELAI_EN_COURS = 20e3;
const ui = { charge: null, mot: '', confirmer: '', brouillons: new Map(), cles: new Map() };
const confirmer = confirmations(ui, () => rendreEnCours());

const moi = () => (E.enCours && E.enCours.moi) || ((sessionActuelle() || {}).admin || {}).identifiant || '';
const gens = () => (E.equipe && E.equipe.personnes) || [];
function teinte(id) {
  const ids = gens().map(p => p.identifiant).sort();
  return 'abcd'[Math.max(0, ids.indexOf(id)) % 4];
}
const avatar = (id, nom) => el('span', { class: `avatar avatar--${teinte(id)}`, 'aria-hidden': 'true' }, (prenom(nom) || id || '?').charAt(0).toUpperCase());
const quiEst = (id, nom) => (id === moi() ? 'toi' : prenom(nom) || id);
const quand = d => { if (!d) return ''; const r = relatif(d); return /^\d/.test(r) ? `le ${r}` : r; };
const claudeDe = (id, nom) => (id === moi() ? 'Ton Claude' : `Claude de ${prenom(nom) || id}`);
const auteur = t => (t.source === 'claude' ? claudeDe(t.qui, t.nom) : majuscule(quiEst(t.qui, t.nom)));

// ─── Lecture et écriture ───────────────────────────────────────────────────
export function chargerEnCours({ frais = false, auto = false } = {}) {
  const a = document.activeElement;
  if (auto && (ui.confirmer || (a && a.closest && a.closest('#equipe-encours form')))) return Promise.resolve();
  if (ui.charge) return ui.charge;
  const s = sessionActuelle();
  ui.charge = api('/portal/admin/en-cours' + (frais ? '?frais=1' : ''), { delai: 45000 })
    .then(d => { if (sessionActuelle() === s) { E.enCours = d; E.enCoursErreur = ''; } })
    .catch(e => { if (e.statut !== 401 && sessionActuelle() === s) E.enCoursErreur = e.statut === 404 ? 'pas-encore' : e.message; })
    .finally(() => { ui.charge = null; if (sessionActuelle() === s) rendreEnCours(); });
  return ui.charge;
}

async function ecrire(chemin, corps) {
  const s = sessionActuelle();
  try {
    const r = await api(`/portal/admin/en-cours/${chemin}`, { methode: 'POST', corps, delai: 45000 });
    if (sessionActuelle() === s && r.tableau) { E.enCours = r.tableau; E.enCoursErreur = ''; }
    return r;
  } catch (e) {
    if (e.statut === 409) chargerEnCours({ frais: true });     // ce qui bloque s'affiche tout de suite
    throw e;
  } finally { if (sessionActuelle() === s) rendreEnCours(); }
}

export function viderEnCours() {
  E.enCours = null; E.enCoursErreur = '';
  Object.assign(ui, { mot: '', confirmer: '' });
  ui.brouillons.clear(); ui.cles.clear();
}

// ─── La carte ──────────────────────────────────────────────────────────────
const ETATS = { actif: ['En direct', 'ok'], endormi: ['Sans nouvelles', 'attente'], perime: ['Périmé', 'neutre'] };

export function rendreEnCours() {
  const boite = $('#equipe-encours');
  if (!boite) return;
  const q = E.enCours;
  const carte = $('#carte-encours');
  if (carte) carte.hidden = E.enCoursErreur === 'pas-encore';
  if (!q) return vider(boite, el('p', { class: 'vide' }, E.enCoursErreur && E.enCoursErreur !== 'pas-encore' ? E.enCoursErreur : 'Lecture en cours…'));
  const lu = date(q.heure_du_quebec);
  vider(boite,
    q.en_cours.length
      ? el('ul', { class: 'encours' }, q.en_cours.map(ligne))
      : el('p', { class: 'vide' }, 'Personne ne travaille sur quelque chose en ce moment. Avant de commencer, chaque Claude regarde ici et réserve son travail.'),
    messagesEquipe(q.messages),
    q.finis_recemment.length ? depliant(`Fini ces 48 dernières heures (${q.finis_recemment.length})`,
      el('ul', { class: 'encours encours--finis' }, q.finis_recemment.map(fini))) : null,
    lu ? el('p', { class: 'note encours__lu' }, `Relu toutes les 20 secondes · dernière lecture à ${heure(new Date())}`) : null);
}

function ligne(t) {
  const [etat, genre] = ETATS[t.etat] || ETATS.actif;
  const vu = date(t.maj_le || t.debut);
  const badges = [badge(t.etat === 'endormi' ? `Sans nouvelles ${quand(vu)}` : etat, genre)];
  if (t.force) badges.push(badge('Réservé malgré un autre travail', 'alerte'));
  const meta = [auteur(t), t.appareil && t.source === 'claude' ? t.appareil.replace(/^Claude \([^)]*\)( · )?/, '') : '',
    `commencé ${quand(date(t.debut))}`, t.etat === 'actif' && t.maj_le !== t.debut ? `nouvelles ${quand(vu)}` : ''].filter(Boolean);
  const peutLiberer = t.qui === moi() || t.etat === 'perime';
  const ouvert = ui.mot === t.id;
  return el('li', { class: `encours__un encours__un--${t.etat}`, 'data-id': t.id },
    avatar(t.qui, t.nom),
    el('div', { class: 'encours__corps' },
      el('p', { class: 'encours__titre' }, el('b', null, t.titre), ...badges),
      el('p', { class: 'encours__meta' }, meta.join(' · ')),
      t.avancement ? el('p', { class: 'encours__avance' }, t.avancement) : null,
      el('p', { class: 'encours__zones' }, t.zones.map(z => el('code', { class: 'encours__zone' }, z)),
        t.branche ? el('code', { class: 'encours__zone encours__zone--branche' }, 'branche ', t.branche) : null),
      t.messages.length ? el('div', { class: 'notes' }, t.messages.slice().reverse().map(message)) : null,
      ouvert ? formMot(t.id) : null,
      el('div', { class: 'encours__actions' },
        ouvert ? null : el('button', { class: 'lien lien--petit', type: 'button', 'data-focus': `mot-${t.id}`,
          onclick: () => { ui.mot = t.id; rendreEnCours(); const z = $(`#mot-${CSS.escape(t.id)}`); if (z) z.focus(); } },
          icone('i-note'), t.qui === moi() ? 'Ajouter un mot' : `Écrire à ${t.source === 'claude' ? 'son Claude' : prenom(t.nom) || t.qui}`),
        peutLiberer ? confirmer(`lib-${t.id}`, 'Libérer', t.qui === moi() ? 'C’est fini ? Libérer ce travail' : `Libérer le travail de ${prenom(t.nom) || t.qui} ?`,
          async () => { await ecrire('liberer', { id: t.id, resultat: 'fini' }); toast('Travail libéré.'); },
          { danger: t.qui !== moi(), classe: 'lien lien--petit' }) : null)));
}

function fini(t) {
  const r = (E.enCours.regles.resultats || {})[t.resultat] || 'Fini';
  return el('li', { class: 'encours__un encours__un--fini' }, avatar(t.qui, t.nom),
    el('div', { class: 'encours__corps' },
      el('p', { class: 'encours__titre' }, el('span', null, t.titre), badge(r, t.resultat === 'fini' ? 'ok' : 'neutre')),
      el('p', { class: 'encours__meta' }, [auteur(t), `libéré ${quand(date(t.fin))}`, t.recap ? 'récap dans « Qui a fait quoi »' : ''].filter(Boolean).join(' · '))));
}

const message = m => el('div', { class: 'note-fil' }, avatar(m.qui, m.nom),
  el('div', { class: 'note-fil__corps' },
    el('p', { class: 'note-fil__qui' }, el('b', null, /^Claude/.test(m.appareil) ? claudeDe(m.qui, m.nom) : majuscule(quiEst(m.qui, m.nom))),
      el('span', null, quand(date(m.quand)))),
    el('p', { class: 'note-fil__texte' }, m.texte)));

function messagesEquipe(messages) {
  const ouvert = ui.mot === 'equipe';
  return el('div', { class: 'encours__messages' },
    el('div', { class: 'encours__messages-tete' }, el('h3', null, 'Messages entre vos Claude'),
      ouvert ? null : el('button', { class: 'lien lien--petit', type: 'button', 'data-focus': 'mot-equipe',
        onclick: () => { ui.mot = 'equipe'; rendreEnCours(); const z = $('#mot-equipe'); if (z) z.focus(); } }, icone('i-note'), 'Écrire à l’équipe')),
    messages.length ? el('div', { class: 'notes' }, messages.slice(0, 6).map(message))
      : el('p', { class: 'vide vide--petit' }, 'Aucun message ces 7 derniers jours. Un Claude qui change quelque chose d’important (les prix, une règle) l’écrit ici.'),
    ouvert ? formMot('equipe') : null);
}

function formMot(cible) {
  const id = `mot-${cible}`;
  const zone = el('textarea', { id, class: 'note-saisie', maxlength: 600, rows: 2, placeholder: 'Ex. : attends ma branche avant de toucher au site' });
  zone.value = ui.brouillons.get(cible) || '';
  zone.addEventListener('input', () => { if (zone.value) ui.brouillons.set(cible, zone.value); else ui.brouillons.delete(cible); });
  const fermer = () => { ui.mot = ''; ui.brouillons.delete(cible); ui.cles.delete(cible); rendreEnCours(); };
  const form = formulaireEnLigne({
    elements: [el('label', { class: 'sr', for: id }, 'Ton mot'), zone],
    bouton: 'Envoyer', annuler: fermer, classe: 'formulaire--note',
    envoyer: async () => {
      const texte = zone.value.trim();
      if (!texte) throw new Invalide('Écris ton mot.', zone);
      if (!ui.cles.has(cible)) ui.cles.set(cible, nouvelleCle('em'));
      await ecrire('message', { texte, chantier: cible === 'equipe' ? '' : cible, cle: ui.cles.get(cible) });
      ui.mot = ''; ui.brouillons.delete(cible); ui.cles.delete(cible);
      rendreEnCours();
      toast('Mot envoyé : les Claude le liront avant leur prochain travail.');
    }
  });
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    else if (e.key === 'Escape') { e.preventDefault(); fermer(); }
  });
  return form;
}

// ─── « Je m'en occupe » : réserver soi-même (un appel, une visite, un dossier) ─
export function ouvrirReservation() {
  if (!E.enCours) { toast('Le tableau « En cours » n’est pas encore lu. Réessaie dans un instant.', true); chargerEnCours(); return; }
  const titre = champTexte('Sur quoi tu travailles', { maxlength: 140, autocomplete: 'off', placeholder: 'Ex. : J’appelle Plomberie Capital' });
  const zones = champTexte('Où', { multiligne: true, rows: 3, maxlength: 700, placeholder: 'Ex. : prospects/plomberie capital' },
    'Une ligne par endroit : un dépôt (uio-site), un dossier, un fichier ou un sujet (agent répondeur, pub v9). Personne d’autre ne pourra le réserver tant que tu ne l’as pas libéré.');
  const cle = nouvelleCle('ec');
  const valeurs = () => ({ titre: titre.input.value.trim(), zones: zones.input.value.split('\n').map(z => z.trim()).filter(Boolean) });
  panneauFormulaire({
    titre: 'Je m’en occupe', sousTitre: 'Dans « En cours », pour que personne ne le fasse en double',
    corps: [titre.boite, zones.boite], bouton: 'Réserver', chemin: 'reserver',
    ecrire,
    preparer: () => {
      const v = valeurs();
      if (!v.titre) throw new Invalide('Écris ce que tu fais, en une phrase courte.', titre.input);
      if (!v.zones.length) throw new Invalide('Écris au moins un endroit.', zones.input);
      return { ...v, cle };
    },
    reussite: 'C’est réservé : les Claude le verront avant de commencer.',
    modifie: () => !!(valeurs().titre || valeurs().zones.length),
    focus: () => titre.input
  });
}
