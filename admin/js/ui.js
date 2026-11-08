// Morceaux d'écran partagés : champs, mot de passe (avec ses règles), code à 6 chiffres,
// bouton « occupé », zone d'erreur et barre de progression des étapes.
import { el, icone } from './outils.js';

let compteur = 0;
const nouvelId = prefixe => `${prefixe}-${++compteur}`;

export const titre = texte => el('h1', { class: 'ecran__titre', tabindex: '-1' }, texte);
export const phrase = (...morceaux) => el('p', { class: 'ecran__texte' }, ...morceaux);
export const erreurZone = (message = '') => el('p', { class: 'erreur', role: 'alert' }, message);

// Un champ avec son étiquette (et une aide sous le champ, reliée pour les lecteurs d'écran)
export function champ({ etiquette, aide, facultatif, ...attrs }) {
  const id = attrs.id || nouvelId('champ');
  const input = el('input', { ...attrs, id });
  const aideEl = aide ? el('p', { class: 'champ__aide', id: `${id}-aide` }, aide) : null;
  if (aideEl) input.setAttribute('aria-describedby', aideEl.id);
  const libelle = el('label', { for: id }, etiquette, facultatif ? el('span', { class: 'facultatif' }, ` (${facultatif})`) : null);
  return { boite: el('div', { class: 'champ' }, libelle, input, aideEl), input };
}

// Le nom d'utilisateur, invisible mais présent : le gestionnaire de mots de passe
// de l'iPhone ou d'Android range le mot de passe (et le code) sous le bon compte.
export const identifiantCache = valeur => el('input', { class: 'sr', type: 'text', name: 'username', autocomplete: 'username',
  value: valeur || '', readonly: true, tabindex: '-1', 'aria-hidden': 'true' });

// Les mots qui ne servent jamais (le serveur a la même liste et décide en dernier)
const FACILES = ['motdepasse', 'password', 'agenceuio', 'azerty', 'qwerty', '123456', 'abcdef', 'uio2026', 'admin123', 'bonjour', 'soleil'];

export function champMotDePasse({ etiquette, autocomplete, aide, facultatif, regles = false, contexte = () => ({}) }) {
  const { boite, input } = champ({ etiquette, aide, facultatif, type: 'password', autocomplete, spellcheck: 'false',
    autocapitalize: 'none', autocorrect: 'off', maxlength: 200, required: !facultatif });
  if (autocomplete === 'new-password') input.setAttribute('passwordrules', 'minlength: 16; required: lower; required: upper; required: digit;');
  const voir = el('button', { class: 'rond voir', type: 'button', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', 'aria-controls': input.id }, icone('i-oeil'));
  voir.addEventListener('click', () => {
    const montrer = input.type === 'password';
    input.type = montrer ? 'text' : 'password';
    voir.setAttribute('aria-pressed', String(montrer));
    voir.setAttribute('aria-label', montrer ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    voir.replaceChildren(icone(montrer ? 'i-oeil-barre' : 'i-oeil'));
    input.focus();
  });
  const enveloppe = el('div', { class: 'mdp' });
  input.replaceWith(enveloppe);
  enveloppe.append(input, voir);

  let liste = null;
  const items = {};
  if (regles) {
    items.longueur = el('li', null, 'Au moins 12 caractères');
    items.nom = el('li', null, 'Ni ton prénom ni ton identifiant');
    items.varie = el('li', null, 'Varié : pas « azerty », pas « motdepasse »');
    liste = el('ul', { class: 'regles', id: `${input.id}-regles` }, items.longueur, items.nom, items.varie);
    boite.append(liste, el('p', { class: 'champ__aide' }, 'Astuce : laisse ton téléphone ou ton navigateur proposer un mot de passe fort. Il le garde pour toi.'));
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), liste.id].filter(Boolean).join(' '));
  }
  const etat = () => {
    const v = input.value.normalize('NFC'), bas = v.toLowerCase();
    const { prenom = '', identifiant = '' } = contexte();
    const p = prenom.trim().toLowerCase(), id = identifiant.trim().toLowerCase();
    return {
      longueur: [...v].length >= 12 && [...v].length <= 200,
      nom: !!v && !(id && bas.includes(id)) && !(p.length >= 3 && bas.includes(p)),
      varie: !!v && new Set(v).size >= 6 && !FACILES.some(m => bas.includes(m))
    };
  };
  const verifier = () => {
    if (!regles) return;
    const e = etat();
    Object.entries(items).forEach(([cle, li]) => li.classList.toggle('ok', e[cle]));
  };
  input.addEventListener('input', verifier);
  return {
    boite, input, verifier,
    valide: () => !regles || Object.values(etat()).every(Boolean),
    valeur: () => input.value
  };
}

// Le code à 6 chiffres : clavier numérique, rempli tout seul par l'iPhone ou Android
// quand l'appli de codes le propose, et envoyé dès le 6e chiffre.
export function champCode({ etiquette = 'Code à 6 chiffres', surComplet } = {}) {
  const { boite, input } = champ({ etiquette, class: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
    pattern: '[0-9]*', required: true, enterkeyhint: 'go', spellcheck: 'false', autocorrect: 'off' });
  let dernier = '';
  input.addEventListener('input', () => {
    const c = input.value.replace(/\D/g, '').slice(0, 6);
    if (c !== input.value) input.value = c;
    if (c.length === 6 && c !== dernier && surComplet) { dernier = c; surComplet(c); }
    if (c.length < 6) dernier = '';
  });
  return { boite, input, valeur: () => input.value.replace(/\D/g, ''), vider: () => { input.value = ''; dernier = ''; } };
}

// Un bouton qui travaille : roue, texte, puis « le serveur se réveille » s'il dort.
export function occuper(bouton, texte = 'Un instant…') {
  const avant = [...bouton.childNodes];
  const libelle = el('span', null, texte);
  bouton.disabled = true;
  bouton.setAttribute('aria-busy', 'true');
  bouton.replaceChildren(el('span', { class: 'roue roue--petite', 'aria-hidden': 'true' }), libelle);
  const lent = setTimeout(() => { if (bouton.isConnected && !bouton.closest('[hidden]')) libelle.textContent = 'Le serveur se réveille…'; }, 5000);
  return () => {
    clearTimeout(lent);
    bouton.disabled = false;
    bouton.removeAttribute('aria-busy');
    bouton.replaceChildren(...avant);
  };
}

// Étape 1, 2 ou 3 de la création d'un compte
export function progression(etape, nom, total = 3) {
  return el('div', { class: 'progression-bloc' },
    el('div', { class: 'progression', 'aria-hidden': 'true' }, Array.from({ length: total }, (_, i) => el('i', { class: i < etape ? 'fait' : null }))),
    el('p', { class: 'progression__texte' }, `Étape ${etape} sur ${total} · ${nom}`));
}

export function depliant(resume, ...contenu) {
  return el('details', { class: 'depliant' }, el('summary', null, resume), ...contenu);
}
