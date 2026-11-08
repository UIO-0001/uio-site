// Le serveur (uio-backend) : chaque requête de l'admin porte la session signée.
import { BACKEND } from './etat.js';
import { lire, ecrire } from './outils.js';

export class ErreurApi extends Error {
  constructor(message, statut, code) { super(message); this.statut = statut; this.code = code || ''; }
}

const CLE_SESSION = 'uio-admin-session';
let session = null;                       // { session, expire (secondes), admin: { identifiant, nom } }
let surPerte = () => {};

export const sessionActuelle = () => session;
export function retenirSession(s) { session = s; ecrire('sessionStorage', CLE_SESSION, JSON.stringify(s)); }
export function oublierSession() { session = null; ecrire('sessionStorage', CLE_SESSION, null); }
export function relireSession() {
  try {
    const s = JSON.parse(lire('sessionStorage', CLE_SESSION) || 'null');
    if (s && typeof s.session === 'string' && s.admin && s.expire * 1000 > Date.now() + 60e3) { session = s; return s; }
  } catch (e) { /* illisible */ }
  oublierSession();
  return null;
}
export const quandSessionPerdue = fn => { surPerte = fn; };

// Ferme la session sur le serveur (Verrouiller, verrou après 15 minutes, fin des 12 heures).
// La page l'a déjà oubliée : même sans réseau, plus rien ne s'ouvre sans Face ID ou le code.
export function fermerSession(s, raison = '') {
  if (!s || !s.session) return Promise.resolve();
  return fetch(BACKEND + '/portal/admin/deconnexion', {
    method: 'POST', headers: { Authorization: 'Bearer ' + s.session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raison }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
  }).catch(() => {});
}

const MESSAGES = {
  400: 'La demande n’est pas valide.', 403: 'Ce n’est pas permis.', 404: 'Le serveur n’a pas encore cette fonction.',
  423: 'Ce compte est bloqué pour le moment.', 429: 'Trop d’essais. Réessaie dans quelques minutes.',
  500: 'Le serveur a eu un problème. Réessaie dans une minute.', 503: 'Le serveur est indisponible pour le moment.'
};

export async function api(chemin, { methode = 'GET', corps, delai = 30000, auth = true } = {}) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), delai);
  try {
    const entetes = {};
    if (auth && session) entetes.Authorization = 'Bearer ' + session.session;
    if (corps) entetes['Content-Type'] = 'application/json';
    const r = await fetch(BACKEND + chemin, {
      method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* pas du JSON */ }
    const message = (data && data.error) || '';
    const code = (data && data.code) || '';
    if (auth && session && r.status === 401) {
      surPerte(code === 'comptes' ? message : 'Ta session est terminée. Reconnecte-toi.');
      throw new ErreurApi('Session terminée.', 401, code || 'session');
    }
    if (!r.ok || (data && data.success === false)) throw new ErreurApi(message || MESSAGES[r.status] || `Le serveur a répondu ${r.status}.`, r.status, code);
    return data || {};
  } catch (e) {
    if (e instanceof ErreurApi) throw e;
    throw new ErreurApi(e.name === 'AbortError'
      ? 'Le serveur met trop de temps à répondre : il se réveille peut-être. Réessaie dans 30 secondes.'
      : 'Impossible de joindre le serveur. Vérifie ta connexion Internet.', 0, 'reseau');
  } finally { clearTimeout(minuterie); }
}
