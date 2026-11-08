// Le panneau qui glisse de la droite (un client, un nouveau client).
import { $, el, vider } from './outils.js';
import { E } from './etat.js';

export function ouvrirPanneau(etat, titre, sousTitre, corps, pied) {
  E.panneau = etat;
  etat.retour = document.activeElement;
  // Si la liste est redessinée pendant que le panneau est ouvert : la même ligne (data-focus), sinon le titre de sa carte
  const depart = etat.retour && etat.retour.closest ? etat.retour : null;
  etat.retourCle = (depart && depart.dataset && depart.dataset.focus) || '';
  etat.retourZone = (depart && depart.closest('[id^="carte-"]') || {}).id || '';
  $('#panneau-titre').textContent = titre;
  $('#panneau-sous-titre').textContent = sousTitre;
  vider($('#panneau-corps'), corps);
  delete $('#panneau-pied').dataset.abandon;
  vider($('#panneau-pied'), pied);
  const p = $('#panneau'), v = $('#voile');
  p.hidden = false; v.hidden = false;
  $('#appli').inert = true;
  document.body.classList.add('avec-panneau');
  requestAnimationFrame(() => { p.classList.add('ouvert'); v.classList.add('ouvert'); });
  // Le focus va au premier champ (ou au titre) : seulement si ce panneau est encore là et ce champ aussi
  setTimeout(() => { if (E.panneau === etat) mettreFocus(etat); }, 60);
}
function mettreFocus(etat) {
  const cible = (etat.focus && etat.focus()) || $('#panneau-titre');
  if (cible) cible.focus();
}
export function fermerPanneau(force = false) {
  const etat = E.panneau;
  if (!etat) return;
  if (!force && etat.modifie()) return demanderAbandon(etat);
  E.panneau = null;
  if (etat.fermer) etat.fermer();
  const p = $('#panneau'), v = $('#voile');
  p.classList.remove('ouvert'); v.classList.remove('ouvert');
  $('#appli').inert = false;
  document.body.classList.remove('avec-panneau');
  // Une fois sorti de l'écran, le panneau se vide : rien ne reste caché dans la page
  setTimeout(() => { if (!E.panneau) { p.hidden = true; v.hidden = true; vider($('#panneau-corps')); vider($('#panneau-pied')); } }, 450);
  const zone = etat.retourZone && document.getElementById(etat.retourZone);
  const retour = etat.retour && document.contains(etat.retour) ? etat.retour
    : (etat.retourCle && document.querySelector(`[data-focus="${CSS.escape(etat.retourCle)}"]`)) || (zone && zone.querySelector('h2'));
  if (!retour) return;
  if (retour.tagName === 'H2') retour.tabIndex = -1;
  retour.focus();
}

// Des changements pas enregistrés : on demande dans le pied du panneau, sans fenêtre du navigateur.
function demanderAbandon(etat) {
  const pied = $('#panneau-pied');
  if (pied.dataset.abandon) return;
  const avant = [...pied.childNodes];
  pied.dataset.abandon = '1';
  const reprendre = () => {
    delete pied.dataset.abandon;
    vider(pied, avant);
    if (etat.majPied) etat.majPied();
    mettreFocus(etat);
  };
  const jeter = el('button', { class: 'btn btn--danger', type: 'button', onclick: () => { delete pied.dataset.abandon; fermerPanneau(true); } }, 'Fermer sans enregistrer');
  vider(pied, el('span', { class: 'modif', role: 'alert' }, 'Les changements ne sont pas enregistrés.'),
    el('button', { class: 'btn btn--discret', type: 'button', onclick: reprendre }, 'Continuer'), jeter);
  etat.reprendre = reprendre;
  jeter.focus();
}
