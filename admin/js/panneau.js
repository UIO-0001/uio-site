// Le panneau qui glisse de la droite (un client, un nouveau client).
import { $, el, vider } from './outils.js';
import { E } from './etat.js';

export function ouvrirPanneau(etat, titre, sousTitre, corps, pied) {
  E.panneau = etat;
  etat.retour = document.activeElement;
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
  setTimeout(() => (etat.focus ? etat.focus() : $('#panneau-titre')).focus(), 60);
}
export function fermerPanneau(force = false) {
  const etat = E.panneau;
  if (!etat) return;
  if (!force && etat.modifie()) return demanderAbandon(etat);
  E.panneau = null;
  const p = $('#panneau'), v = $('#voile');
  p.classList.remove('ouvert'); v.classList.remove('ouvert');
  $('#appli').inert = false;
  document.body.classList.remove('avec-panneau');
  setTimeout(() => { if (!E.panneau) { p.hidden = true; v.hidden = true; } }, 450);
  if (etat.retour && document.contains(etat.retour)) etat.retour.focus();
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
    (etat.focus ? etat.focus() : $('#panneau-titre')).focus();
  };
  const jeter = el('button', { class: 'btn btn--danger', type: 'button', onclick: () => { delete pied.dataset.abandon; fermerPanneau(true); } }, 'Fermer sans enregistrer');
  vider(pied, el('span', { class: 'modif', role: 'alert' }, 'Les changements ne sont pas enregistrés.'),
    el('button', { class: 'btn btn--discret', type: 'button', onclick: reprendre }, 'Continuer'), jeter);
  etat.reprendre = reprendre;
  jeter.focus();
}
