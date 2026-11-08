// L'état partagé de l'admin et ses réglages.
const meta = document.querySelector('meta[name="uio-backend"]');
export const BACKEND = ((meta && meta.content) || 'https://uio-backend.onrender.com').replace(/\/+$/, '');
export const DEPOT = 'UIO-0001/uio-site';
export const SITE = new URL('../', location.href).href;            // la page d'accueil du site
export const ESPACE_CLIENT = 'https://agenceuio.ca/client.html';
export const DELAIS = { tableau: 120e3, clients: 120e3, ping: 30e3, github: 300e3, offre: 600e3, horloge: 15e3, compte: 120e3, argent: 120e3 };
export const VERROU_APRES = 15 * 60e3;                              // verrouillé après 15 min en arrière-plan
export const TITRE = document.title;

export const E = {
  vue: 'tableau', minuteries: [],
  tableau: null, tableauErreur: '', majTableau: 0, lecture: false,
  clients: [], fonctionnalites: [], clientsErreur: '', clientsLus: false,
  github: null, githubErreur: '', githubLu: 0, offre: null, offreErreur: '',
  pings: [], reveil: 0, panneau: null, recherche: '',
  neufs: new Map(), nonVus: 0, annonce: 0,
  moi: null, moiErreur: '', journal: null, journalErreur: '', filtreJournal: 'tout',
  argent: null, argentErreur: '', argentLu: 0
};
