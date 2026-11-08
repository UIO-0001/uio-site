// Morceaux d'écran partagés par les onglets Argent et Équipe : typographie française,
// champs, choix en pilules, formulaires (dans une carte ou dans le panneau qui glisse de la
// droite), confirmations sur place (jamais de fenêtre du navigateur), rangées et badges.
import { el as elBrut, icone, toast } from './outils.js';
import { ouvrirPanneau, fermerPanneau } from './panneau.js';
import { occuper } from './ui.js';

// La typographie française : pas de « : » ni de « ? » seul au début d'une ligne
export const fr = t => (typeof t === 'string' ? t.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ') : t);
export const el = (tag, attrs, ...enfants) => elBrut(tag, attrs, ...enfants.flat(Infinity).map(fr));

// Une donnée refusée avant l'envoi : le message, et le champ à corriger
export class Invalide extends Error { constructor(message, champ) { super(message); this.champ = champ; } }

let compteur = 0;
export const idNeuf = p => `${p}-${++compteur}`;

// La clé d'un nouvel ajout, tirée au hasard par l'app : renvoyé deux fois, il ne compte qu'une fois
export const nouvelleCle = prefixe => {
  const v = new Uint8Array(8);
  crypto.getRandomValues(v);
  return `${prefixe}_${[...v].map(b => b.toString(16).padStart(2, '0')).join('')}`;
};

// ─── Petits morceaux d'écran ───────────────────────────────────────────────
export const badge = (texte, genre = '') => el('span', { class: `badge${genre ? ` badge--${genre}` : ''}` }, texte);
export const grand = (texte, libelle, ...phrase) => el('div', { class: 'gros' },
  el('p', { class: 'gros__ligne' }, el('b', null, texte), libelle ? el('span', null, libelle) : null),
  phrase.length ? el('p', null, phrase.map(m => Array.isArray(m) ? el('b', null, m[0]) : m)) : null);
export function rangee({ icon, lettre, titre, badges = [], meta = [], action = null, classe = '' }) {
  return el('div', { class: `rangee${classe ? ` ${classe}` : ''}` },
    el('span', { class: 'rangee__icone', 'aria-hidden': 'true' }, lettre ? el('b', null, lettre) : icone(icon)),
    el('span', { class: 'rangee__texte' },
      el('span', { class: 'rangee__titre' }, titre, ...badges.filter(Boolean)),
      ...meta.filter(Boolean).map(m => el('span', { class: 'rangee__meta' }, m))),
    action ? el('span', { class: 'rangee__action' }, action) : el('span'));
}

// Confirmer sur place (aucune fenêtre du navigateur) : « Annuler ce paiement ? Non · Oui ».
// etat.confirmer garde la confirmation ouverte ; redessiner refait l'écran qui la montre.
export function confirmations(etat, redessinerParDefaut) {
  return function confirmer(cle, libelle, question, faire, { danger = true, classe = 'btn btn--contour btn--petit', redessiner = redessinerParDefaut } = {}) {
    // Après « Non », ou un « Oui » réussi : le focus revient au bouton de départ (redessiné)
    const revenir = () => { const b = document.querySelector(`[data-focus="${CSS.escape(`conf-${cle}`)}"]`); if (b) b.focus(); };
    if (etat.confirmer !== cle) {
      return el('button', { class: classe, type: 'button', 'data-focus': `conf-${cle}`, onclick: () => {
        etat.confirmer = cle; redessiner();
        const oui = document.querySelector(`[data-confirmer="${CSS.escape(cle)}"]`);
        if (oui) oui.focus();
      } }, libelle);
    }
    const oui = el('button', { class: `btn btn--petit${danger ? ' btn--danger' : ''}`, type: 'button', 'data-confirmer': cle }, 'Oui');
    oui.addEventListener('click', async () => {
      const liberer = occuper(oui, '…');
      try { await faire(); }
      catch (e) { liberer(); if (e.statut !== 401) toast(e.message || 'Ça n’a pas marché. Réessaie.', true); return; }
      if (etat.confirmer === cle) { etat.confirmer = ''; redessiner(); revenir(); }
    });
    return el('span', { class: 'confirmer', role: 'group', 'aria-label': question },
      el('span', { class: 'confirmer__question' }, question),
      el('span', { class: 'confirmer__boutons' },
        el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { etat.confirmer = ''; redessiner(); revenir(); } }, 'Non'), oui));
  };
}

// Une durée en minutes : « 45 min », « 2 h 05 »
export function dureeHM(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m}\u00a0min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}\u00a0h\u00a0${String(r).padStart(2, '0')}` : `${h}\u00a0h`;
}

// ─── Champs ────────────────────────────────────────────────────────────────
export function champTexte(etiquette, attrs = {}, aide = '', facultatif = '') {
  const id = idNeuf('ch');
  const { multiligne, ...reste } = attrs;
  const input = multiligne ? el('textarea', { ...reste, id }) : el('input', { type: 'text', ...reste, id });
  const aideEl = aide ? el('p', { class: 'champ__aide', id: `${id}-aide` }, aide) : null;
  if (aideEl) input.setAttribute('aria-describedby', aideEl.id);
  const etiquetteEl = el('label', { for: id }, etiquette);
  const boite = el('div', { class: 'champ' }, el('span', { class: 'champ__etiquette' }, etiquetteEl, facultatif ? el('span', { class: 'facultatif' }, ` (${facultatif})`) : null), input, aideEl);
  return { boite, input, aide: aideEl, etiquette: etiquetteEl };
}
export const champDate = (etiquette, valeur, { min, max, aide = '', facultatif = '' } = {}) =>
  champTexte(etiquette, { type: 'date', value: valeur || null, min, max }, aide, facultatif);

export function pilules(legende, options, valeur, surChange = () => {}, { aide = '', petit = false } = {}) {
  const nom = idNeuf('pi');
  const boite = el('fieldset', { class: `choix${petit ? ' choix--petit' : ''}` }, el('legend', null, legende),
    el('div', { class: 'choix__liste' }, options.map(([v, t]) => el('label', null,
      el('input', { type: 'radio', name: nom, value: v, checked: v === valeur, onchange: () => surChange(v) }), el('span', null, t)))),
    aide ? el('p', { class: 'champ__aide' }, aide) : null);
  return { boite, lire: () => { const x = boite.querySelector('input:checked'); return x ? x.value : ''; }, premier: () => boite.querySelector('input'),
    choisir: x => { const i = [...boite.querySelectorAll('input')].find(n => n.value === x); if (i) i.checked = true; } };
}
export function liste(etiquette, options, valeur, aide = '') {
  const id = idNeuf('li');
  const input = el('select', { id }, options.map(([v, t]) => el('option', { value: v, selected: v === valeur }, t)));
  return { boite: el('div', { class: 'champ' }, el('label', { for: id }, etiquette), el('div', { class: 'selecteur' }, input), aide ? el('p', { class: 'champ__aide' }, aide) : null), input };
}
export function bascule(titre, detail, coche, surChange = () => {}) {
  const input = el('input', { type: 'checkbox', role: 'switch', checked: coche, onchange: e => surChange(e.target.checked) });
  return { boite: el('label', { class: 'interrupteur' }, el('span', null, el('b', null, titre), detail ? el('span', null, detail) : null), input), input };
}

// ─── Formulaires ───────────────────────────────────────────────────────────
// Un formulaire dans une carte ou dans le panneau (solde, paiement d'une facture, note…)
export function formulaireEnLigne({ elements, bouton, envoyer, annuler, danger = false, classe = '' }) {
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const ok = el('button', { class: `btn btn--petit${danger ? ' btn--danger' : ''}`, type: 'submit' }, bouton);
  const form = el('form', { class: `formulaire formulaire--encadre${classe ? ` ${classe}` : ''}`, novalidate: true }, elements, erreur,
    el('div', { class: 'formulaire__pied' }, annuler ? el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: annuler }, 'Annuler') : null, ok));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (ok.disabled) return;
    erreur.textContent = '';
    const liberer = occuper(ok, 'Enregistrement…');
    try { await envoyer(); }
    catch (e) {
      liberer();
      if (e.statut === 401) return;
      erreur.textContent = fr(e.message);
      if (e.champ) e.champ.focus();
    }
  });
  return form;
}

// Un formulaire dans le panneau qui glisse de la droite : Annuler, Enregistrer (⌘S), Échap.
// ecrire(chemin, demande) envoie au serveur et redessine l'onglet.
// edition : on change une chose qui existe déjà. « Enregistrer » reste gris tant que rien
// n'a changé, et une pastille dit qu'il y a des changements pas encore enregistrés.
export function panneauFormulaire({ titre, sousTitre = '', avant = [], corps, apres = [], bouton, chemin, preparer, reussite, modifie, focus, rafraichir, edition = false, ecrire }) {
  const id = idNeuf('form');
  const erreur = el('p', { class: 'erreur', role: 'alert' });
  const form = el('form', { class: 'formulaire', id, novalidate: true }, corps, erreur);
  const ok = el('button', { class: 'btn', type: 'submit', form: id, disabled: edition }, bouton);
  const marque = edition ? el('span', { class: 'modif', hidden: true }, 'Changements non enregistrés') : null;
  const etat = { modifie: () => !etat.fini && modifie(), focus, rafraichir };
  if (edition) etat.majPied = () => { const m = etat.modifie(); marque.hidden = !m; if (!etat.envoi) ok.disabled = !m; };
  const envoyer = async () => {
    if (etat.envoi || (edition && !etat.modifie())) return;
    erreur.textContent = '';
    let demande;
    try { demande = preparer(); }
    catch (e) { erreur.textContent = fr(e.message); if (e.champ) e.champ.focus(); return; }
    etat.envoi = true;
    const liberer = occuper(ok, 'Enregistrement…');
    try {
      const r = await ecrire(chemin, demande);
      etat.fini = true;
      fermerPanneau(true);
      toast(typeof reussite === 'function' ? reussite(r) : reussite);
    } catch (e) {
      liberer();
      etat.envoi = false;
      if (etat.majPied) etat.majPied();
      if (e.statut !== 401) erreur.textContent = fr(e.message);
    }
  };
  form.addEventListener('submit', ev => { ev.preventDefault(); envoyer(); });
  if (edition) for (const type of ['input', 'change']) form.addEventListener(type, () => etat.majPied());
  etat.enregistrer = envoyer;
  ouvrirPanneau(etat, titre, sousTitre, [...avant, form, ...apres],
    [marque, el('button', { class: `btn btn--discret${marque ? '' : ' ml-auto'}`, type: 'button', onclick: () => fermerPanneau() }, edition ? 'Fermer' : 'Annuler'), ok]);
  return etat;
}
