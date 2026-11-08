// Le rapport du mois d'un client (dans son panneau) : ce qu'il voit dans son espace client
// (appels, textos, minutes du forfait, comptés par le serveur), et ce qu'on note à la main :
// ses avis Google du mois et un mot de l'équipe. Enregistré avec le bouton du panneau.
import { nombre, majuscule, toast } from './outils.js';
import { api } from './api.js';
import { el, fr, champTexte, liste, Invalide } from './formes.js';

const MOT_MAX = 600;
const CHAMPS = ['avis_nouveaux', 'note', 'total_avis', 'mot'];

const entier = (texte, min, max) => {
  const t = String(texte || '').replace(/[\s  ]/g, '');
  if (!t) return '';
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? String(n) : null;
};
const decimal = texte => {
  const t = String(texte || '').trim().replace(',', '.');
  if (!t) return '';
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 5 ? (Math.round(n * 10) / 10).toFixed(1) : null;
};
const noteLisible = v => (v ? String(v).replace('.', ',') : '');

// c : le client ; change : à appeler quand un champ change (le pied du panneau se met à jour)
export function blocRapport(c, change) {
  const client = String(c.client_id);
  const nom = c.project_name || client;
  const R = { mois: '', rapport: null, initial: null, lecture: false, erreur: '' };

  const resume = el('div', { class: 'rapport-admin__resume', 'aria-live': 'polite' });
  const choixMois = el('div', { class: 'rapport-admin__mois' });
  const nouveaux = champTexte('Nouveaux avis', { inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex. : 3' });
  const note = champTexte('Note moyenne', { inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex. : 4,8' });
  const total = champTexte('Total d’avis', { inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex. : 37' });
  const mot = champTexte('Mot de l’équipe pour ce mois', { multiligne: true, maxlength: String(MOT_MAX),
    placeholder: 'Ex. : 11 appels pris après 17 h cette semaine, dont 2 urgences.' },
    '', 'facultatif');
  const compte = el('p', { class: 'champ__aide' });
  const majCompte = () => { compte.textContent = `${mot.input.value.length} / ${MOT_MAX} caractères. Le client le voit en haut de son rapport.`; };
  mot.boite.append(compte);
  const qui = el('p', { class: 'note' });
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const saisie = el('div', { class: 'rapport-admin__saisie', hidden: true },
    el('fieldset', { class: 'rapport-admin__avis' }, el('legend', null, 'Avis Google ce mois-ci',
      el('span', { class: 'facultatif' }, ' (facultatif, sur sa fiche Google)')),
      el('div', { class: 'trois' }, nouveaux.boite, note.boite, total.boite)),
    mot.boite, qui, erreur);
  for (const ch of [nouveaux, note, total, mot]) ch.input.addEventListener('input', () => { erreur.textContent = ''; if (ch === mot) majCompte(); change(); });

  const boite = el('section', { class: 'bloc rapport-admin', 'aria-labelledby': `rapport-${client}`, 'aria-busy': 'true' },
    el('div', { class: 'rapport-admin__tete' }, el('h3', { id: `rapport-${client}` }, 'Rapport du mois'), choixMois),
    el('p', null, `Ce que ${nom} voit dans son espace client : les appels et les textos se comptent tout seuls ; les avis et le mot, c’est vous.`),
    resume, saisie);

  const valeurs = () => ({ avis_nouveaux: nouveaux.input.value.trim(), note: note.input.value.trim(), total_avis: total.input.value.trim(), mot: mot.input.value.trim() });
  const normaliser = v => ({ avis_nouveaux: entier(v.avis_nouveaux, 0, 1000) ?? v.avis_nouveaux, note: decimal(v.note) ?? v.note,
    total_avis: entier(v.total_avis, 0, 100000) ?? v.total_avis, mot: v.mot });
  const modifie = () => !!R.initial && JSON.stringify(normaliser(valeurs())) !== JSON.stringify(normaliser(R.initial));

  function remplir(s) {
    R.initial = { avis_nouveaux: String(s.avis_nouveaux || ''), note: noteLisible(s.note), total_avis: String(s.total_avis || ''), mot: String(s.mot || '') };
    nouveaux.input.value = R.initial.avis_nouveaux;
    note.input.value = R.initial.note;
    total.input.value = R.initial.total_avis;
    mot.input.value = R.initial.mot;
    majCompte();
    if (s.maj_le) {
      const d = new Date(s.maj_le);
      const quand = isNaN(d) ? '' : d.toLocaleString('fr-CA', { timeZone: 'America/Toronto', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
      qui.textContent = `Noté${s.maj_par ? ` par ${majuscule(s.maj_par)}` : ''}${quand ? `, le ${quand.replace(/\s/g, ' ')}` : ''}.`;
    } else qui.textContent = '';
    qui.hidden = !s.maj_le;
  }

  function dessinerMois() {
    const r = R.rapport;
    if (!r || !(r.mois_disponibles || []).length) return choixMois.replaceChildren();
    const l = liste('Mois', r.mois_disponibles.map(m => [m.mois, majuscule(m.titre)]), r.mois);
    l.boite.classList.add('champ--compact');
    l.boite.querySelector('label').classList.add('sr');
    l.input.addEventListener('change', () => {
      if (modifie()) {
        l.input.value = r.mois;
        toast(fr('Enregistre d’abord les changements de ce mois (ou ferme le panneau sans enregistrer).'), true);
        return;
      }
      charger(l.input.value);
    });
    choixMois.replaceChildren(l.boite);
  }

  function chiffre(nomC, valeur, detail) {
    return el('div', null, el('dt', null, nomC), el('dd', null, valeur, detail ? el('small', null, detail) : null));
  }

  function dessinerResume() {
    const r = R.rapport;
    if (R.lecture && !r) return resume.replaceChildren(el('p', { class: 'vide' }, 'Lecture du rapport… (le serveur compte les appels du mois)'));
    if (!r) {
      return resume.replaceChildren(el('p', { class: 'vide' }, `Le rapport n’a pas pu être lu. ${R.erreur}`.trim(), ' ',
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => charger(R.mois) }, 'Réessayer')));
    }
    const a = r.appels, t = r.textos, f = r.forfait;
    const blocs = [];
    if (a && a.disponible) {
      blocs.push(el('dl', { class: 'chiffres' },
        chiffre('Appels', nombre(a.total), a.total ? `${nombre(a.hors_heures)} hors heures` : ''),
        chiffre('Nouveaux', nombre(a.nouveaux)),
        chiffre('Rappels', nombre(a.rappels)),
        chiffre('Urgences', nombre(a.urgences)),
        chiffre('Textos', t && t.disponible ? nombre(t.appelants) : '—', t && t.disponible && t.urgences ? `+ ${nombre(t.urgences)} de garde` : ''),
        f ? chiffre('Forfait', `${nombre(Math.round(f.minutes))} / ${nombre(f.incluses)}`, 'minutes') : chiffre('Minutes', nombre(Math.round(a.minutes)))));
    } else if (a) {
      blocs.push(el('p', { class: 'vide' }, a.raison || 'Les chiffres des appels reviennent dans quelques minutes.'));
    } else {
      blocs.push(el('p', { class: 'vide' }, 'Aucun agent répondeur relié à ce client. Pour en relier un : Argent → son abonnement → ', el('b', null, 'Agents Retell'), '.'));
      if (t && t.disponible) blocs.push(el('dl', { class: 'chiffres' }, chiffre('Textos', nombre(t.appelants))));
    }
    blocs.push(el('p', { class: 'note' }, r.vide && !modifie()
      ? 'Rien à montrer pour ce mois : le rapport reste caché dans son espace client.'
      : `Le client voit ce rapport (${r.titre}) dans son espace client.`));
    resume.replaceChildren(...blocs);
  }

  async function charger(mois = '') {
    if (R.lecture) return;
    R.lecture = true; R.erreur = '';
    boite.setAttribute('aria-busy', 'true');
    dessinerResume();
    try {
      const d = await api(`/portal/admin/rapport?client=${encodeURIComponent(client)}${mois ? `&mois=${encodeURIComponent(mois)}` : ''}`, { delai: 60000 });
      R.rapport = d.rapport; R.mois = d.rapport.mois;
      remplir(d.saisie || {});
      saisie.hidden = false;
    } catch (e) {
      if (e.statut === 401) return;
      R.erreur = e.message || '';
      if (!R.rapport) saisie.hidden = true;
      else toast(fr(`Ce mois n’a pas pu être lu. ${R.erreur}`), true);
    } finally {
      R.lecture = false;
      boite.setAttribute('aria-busy', 'false');
      dessinerMois(); dessinerResume(); change();
    }
  }

  // Avant l'envoi : les mêmes règles que le serveur (sinon : Invalide, avec le champ à corriger)
  function preparer() {
    const v = valeurs();
    const n = entier(v.avis_nouveaux, 0, 1000), moy = decimal(v.note), tot = entier(v.total_avis, 0, 100000);
    if (n === null) throw new Invalide('Les nouveaux avis : un nombre de 0 à 1000.', nouveaux.input);
    if (moy === null) throw new Invalide('La note moyenne : de 1 à 5 (ex. : 4,8).', note.input);
    if (tot === null) throw new Invalide('Le total des avis : un nombre de 0 à 100 000.', total.input);
    if (v.mot.length > MOT_MAX) throw new Invalide(`Le mot : ${MOT_MAX} caractères au plus.`, mot.input);
    return { client, mois: R.mois, avis_nouveaux: n, note: moy, total_avis: tot, mot: v.mot };
  }
  async function envoyer(demande) {
    const d = await api('/portal/admin/rapport', { methode: 'POST', corps: demande });
    if (d.rapport) { R.rapport = d.rapport; R.mois = d.rapport.mois; }
    if (d.saisie) remplir(d.saisie);
    dessinerResume();
    return d;
  }
  function montrerErreur(e) {
    erreur.textContent = fr(e.message || 'Ça n’a pas marché. Réessaie.');
    if (e.champ) e.champ.focus();
  }

  charger('');
  return { boite, modifie, preparer, envoyer, montrerErreur, effacerErreur: () => { erreur.textContent = ''; } };
}
