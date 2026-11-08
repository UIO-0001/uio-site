// Les cinq vues (Tableau de bord, Clients, Argent, Équipe, Compte) et la lentille sous l'onglet actif.
import { $, $$ } from './outils.js';
import { E } from './etat.js';

export const VUES = ['tableau', 'clients', 'argent', 'equipe', 'compte'];
const crochets = {};
export const quandVue = (vue, fn) => { (crochets[vue] = crochets[vue] || []).push(fn); };
export const vueDuLien = () => { const h = location.hash.slice(1); return h === 'prospects' ? 'clients' : VUES.includes(h) ? h : 'tableau'; };   // #prospects : Clients → Prospects

export function placerLentille() {
  const actif = $('.onglets [aria-selected="true"]'), l = $('.onglets .lentille');
  if (!actif || !l) return;
  l.style.width = actif.offsetWidth + 'px';
  l.style.transform = `translateX(${actif.offsetLeft}px)`;
  if (actif.offsetWidth && !l.classList.contains('pret')) { void l.offsetWidth; l.classList.add('pret'); }   // pas de glissade à l'ouverture
}

export function montrer(vue, focus = false) {
  if (!VUES.includes(vue) || !$('#vue-' + vue)) vue = 'tableau';   // une page plus ancienne n'a pas toutes les vues
  E.vue = vue;
  $$('.onglets [role=tab]').forEach(b => { const oui = b.dataset.vue === vue; b.setAttribute('aria-selected', String(oui)); b.tabIndex = oui ? 0 : -1; });
  VUES.forEach(v => { const s = $('#vue-' + v); if (s) s.hidden = v !== vue; });
  placerLentille();
  if (history.replaceState) history.replaceState(null, '', vue === 'tableau' ? location.pathname + location.search : '#' + vue);
  (crochets[vue] || []).forEach(fn => fn());
  if (focus && $(`#onglet-${vue}`)) $(`#onglet-${vue}`).focus();
  window.scrollTo({ top: 0 });
}
