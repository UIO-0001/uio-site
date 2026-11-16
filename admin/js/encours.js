// « En cours maintenant » (onglet Équipe) : ce que chaque associé et son Claude font en ce
// moment, pour ne jamais travailler deux fois sur la même chose. Avant de commencer, chaque
// Claude lit ce tableau et réserve son travail (quoi, où, sur quelle branche) ; il donne des
// nouvelles, puis il libère le travail avec son récap. Le serveur refuse une réservation qui
// croise celle d'un autre. Tout est rempli par les Claude eux-mêmes (aucune saisie à la main) :
// ici, on regarde en direct (relu toutes les 20 s) et on ne fait que libérer un travail périmé.
import { $, icone, vider, majuscule, date, relatif, heure, toast } from './outils.js';
import { E } from './etat.js';
import { api, sessionActuelle } from './api.js';
import { depliant } from './ui.js';
import { prenom } from './tableau.js';
import { el, badge, confirmations } from './formes.js';

export const DELAI_EN_COURS = 20e3;
const ui = { charge: null, confirmer: '' };
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
  ui.confirmer = '';
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
  const taches = (t.taches || []).map(id => trouverTache(id)).filter(Boolean);
  return el('li', { class: `encours__un encours__un--${t.etat}`, 'data-id': t.id },
    avatar(t.qui, t.nom),
    el('div', { class: 'encours__corps' },
      el('p', { class: 'encours__titre' }, el('b', null, t.titre), ...badges),
      el('p', { class: 'encours__meta' }, meta.join(' · ')),
      t.avancement ? el('p', { class: 'encours__avance' }, t.avancement) : null,
      el('p', { class: 'encours__zones' }, t.zones.map(z => el('code', { class: 'encours__zone' }, z)),
        t.branche ? el('code', { class: 'encours__zone encours__zone--branche' }, 'branche ', t.branche) : null),
      taches.length ? el('p', { class: 'encours__taches' }, icone('i-ok'),
        taches.length > 1 ? 'Tâches cochées toutes seules à la fin : ' : 'Tâche cochée toute seule à la fin : ',
        taches.map(x => x.titre).join(' · ')) : null,
      t.messages.length ? el('div', { class: 'notes' }, t.messages.slice().reverse().map(message)) : null,
      // Un travail se libère tout seul quand son Claude a fini. Seul un travail périmé (12 h sans
      // nouvelles : le Claude a été fermé) se libère ici, pour qu'il ne bloque personne.
      t.etat === 'perime' ? el('div', { class: 'encours__actions' },
        confirmer(`lib-${t.id}`, 'Libérer', t.qui === moi() ? 'Ton Claude a été fermé ? Libérer ce travail' : `Libérer le travail de ${prenom(t.nom) || t.qui} ?`,
          async () => { await ecrire('liberer', { id: t.id, resultat: 'abandonne' }); toast('Travail libéré.'); },
          { danger: t.qui !== moi(), classe: 'lien lien--petit' })) : null));
}

const trouverTache = id => (E.equipe && E.equipe.taches ? E.equipe.taches.find(x => x.id === id) : null);

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
  return el('div', { class: 'encours__messages' },
    el('div', { class: 'encours__messages-tete' }, el('h3', null, 'Messages entre vos Claude')),
    messages.length ? el('div', { class: 'notes' }, messages.slice(0, 6).map(message))
      : el('p', { class: 'vide vide--petit' }, 'Aucun message ces 7 derniers jours. Un Claude qui change quelque chose d’important (les prix, une règle) l’écrit ici tout seul.'));
}
