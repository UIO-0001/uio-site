// Les vues du CRM : quatre onglets (Tableau, Clients, Argent, Équipe) et les Réglages, ouverts par
// la roue de la barre, avec leurs pages (sécurité, notifications, Claude, historique, système, affichage).
import { $, $$ } from './outils.js';
import { E } from './etat.js';

export const ONGLETS = ['tableau', 'clients', 'argent', 'equipe'];
export const VUES = [...ONGLETS, 'reglages'];
export const PAGES = ['securite', 'notifications', 'claude', 'historique', 'systeme', 'affichage'];
const crochets = {}, crochetsPage = {};
export const quandVue = (vue, fn) => { (crochets[vue] = crochets[vue] || []).push(fn); };
export const quandPage = (page, fn) => { (crochetsPage[page] = crochetsPage[page] || []).push(fn); };

// Le lien de la page (#argent, #historique…). #compte : l'ancien onglet Compte (la notification
// d'essai d'un serveur plus ancien y mène encore), donc ses notifications.
export function lireLien(h = location.hash.slice(1)) {
  if (h === 'prospects') return { vue: 'clients' };
  if (ONGLETS.includes(h)) return { vue: h };
  if (h === 'reglages') return { vue: 'reglages', page: E.page || 'securite' };
  if (h === 'compte') return { vue: 'reglages', page: 'notifications' };
  if (PAGES.includes(h)) return { vue: 'reglages', page: h };
  return { vue: 'tableau' };
}
export const vueDuLien = () => lireLien().vue;
export const allerAuLien = () => { const l = lireLien(); montrer(l.vue, { page: l.page }); };

export function placerLentille() {
  const actif = $('.onglets [aria-selected="true"]'), l = $('.onglets .lentille');
  if (!l) return;
  l.classList.toggle('cachee', !actif);
  if (!actif) return;
  l.style.width = actif.offsetWidth + 'px';
  l.style.transform = `translateX(${actif.offsetLeft}px)`;
  if (actif.offsetWidth && !l.classList.contains('pret')) { void l.offsetWidth; l.classList.add('pret'); }
}

// Une page des réglages : le menu montre où l'on est, les autres pages se cachent
export function montrerPage(page, focus = false) {
  if (!PAGES.includes(page)) page = 'securite';
  E.page = page;
  $$('.reglages__menu [data-page]').forEach(b => {
    if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('.reglages__page').forEach(p => { p.hidden = p.dataset.page !== page; });
  $('#vue-reglages').dataset.page = page;
  if (E.vue === 'reglages' && history.replaceState) history.replaceState(null, '', page === 'securite' ? '#reglages' : '#' + page);
  (crochetsPage[page] || []).forEach(fn => fn());
  if (focus) { const t = $(`#reglages-${page} h2`); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } }
}

// montrer('argent') ; montrer('reglages', { page: 'historique' }) ; focus : l'onglet (flèches du clavier)
export function montrer(vue, options = {}) {
  const { focus = false, page = null } = typeof options === 'boolean' ? { focus: options } : options;
  if (!VUES.includes(vue) || !$('#vue-' + vue)) vue = 'tableau';
  const avant = E.vue;
  E.vue = vue;
  if (ONGLETS.includes(vue)) E.onglet = vue;
  const garde = ONGLETS.includes(vue) ? vue : (E.onglet || 'tableau');   // l'onglet qui reçoit Tab dans la barre
  $$('.onglets [role=tab]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.vue === vue));
    b.tabIndex = b.dataset.vue === garde ? 0 : -1;
  });
  const roue = $('#reglages-ouvrir');
  if (roue) { if (vue === 'reglages') roue.setAttribute('aria-current', 'page'); else roue.removeAttribute('aria-current'); }
  VUES.forEach(v => { const s = $('#vue-' + v); if (s) s.hidden = v !== vue; });
  placerLentille();
  if (vue === 'reglages') montrerPage(page || E.page || 'securite');            // elle écrit aussi le lien (#historique…)
  else if (history.replaceState) history.replaceState(null, '', vue === 'tableau' ? location.pathname + location.search : '#' + vue);
  (crochets[vue] || []).forEach(fn => fn());
  if (focus && $(`#onglet-${vue}`)) $(`#onglet-${vue}`).focus();
  if (vue !== avant || vue !== 'reglages') window.scrollTo({ top: 0 });
}
