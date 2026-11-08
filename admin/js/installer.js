// Installer l'admin comme une app. Android et ordinateur (Chrome, Edge) : le bouton
// du navigateur. iPhone et iPad : Safari, « Partager », puis « Sur l’écran d’accueil ».
import { el, icone, estIOS, estAndroid, estInstallee } from './outils.js';

let invite = null;
const abonnes = new Set();
const prevenir = () => abonnes.forEach(f => { try { f(); } catch (e) { /* rien */ } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invite = e; prevenir(); });
window.addEventListener('appinstalled', () => { invite = null; prevenir(); });
export const quandInstallChange = f => abonnes.add(f);

export async function installer() {
  if (!invite) return false;
  const e = invite;
  invite = null;
  e.prompt();
  const choix = await e.userChoice.catch(() => null);
  prevenir();
  return !!(choix && choix.outcome === 'accepted');
}

export function blocInstaller() {
  if (estInstallee()) {
    return [el('div', { class: 'rangee' },
      el('span', { class: 'rangee__icone' }, icone('i-ok')),
      el('span', { class: 'rangee__texte' }, el('span', { class: 'rangee__titre' }, 'Installée sur cet appareil'),
        el('span', { class: 'rangee__meta' }, 'L’admin s’ouvre depuis l’icône « UIO Admin », en plein écran.')))];
  }
  const blocs = [el('p', { class: 'ecran__texte' }, 'Une icône sur l’écran d’accueil, l’admin en plein écran, Face ID ou l’empreinte pour entrer, et les notifications (sur iPhone, seulement dans l’app installée).')];
  if (invite) {
    blocs.push(el('button', { class: 'btn debut', type: 'button', onclick: async () => { await installer(); } },
      icone('i-plus-carre'), 'Installer l’application'));
  } else if (estIOS()) {
    blocs.push(el('ol', { class: 'etapes-installer' },
      el('li', null, el('span', null, 'Ouvre ', el('b', null, 'agenceuio.ca/admin'), ' dans Safari.')),
      el('li', null, el('span', null, 'Touche ', el('b', null, 'Partager '), icone('i-partager'), ' (en bas de l’écran, ou dans le menu ··· ).')),
      el('li', null, el('span', null, 'Choisis ', el('b', null, 'Sur l’écran d’accueil'), ', puis ', el('b', null, 'Ajouter'), '.'))));
  } else if (estAndroid()) {
    blocs.push(el('ol', { class: 'etapes-installer' },
      el('li', null, el('span', null, 'Ouvre ', el('b', null, 'agenceuio.ca/admin'), ' dans Chrome.')),
      el('li', null, el('span', null, 'Touche le menu ', el('b', null, '⋮'), ' en haut à droite.')),
      el('li', null, el('span', null, 'Choisis ', el('b', null, 'Installer l’application'), ' (ou ', el('b', null, 'Ajouter à l’écran d’accueil'), ').'))));
  } else {
    blocs.push(el('ol', { class: 'etapes-installer' },
      el('li', null, el('span', null, 'Chrome ou Edge : l’icône ', el('b', null, 'Installer'), ' au bout de la barre d’adresse, ou le menu ⋮ puis ', el('b', null, 'Installer UIO Admin'), '.')),
      el('li', null, el('span', null, 'Safari sur Mac : menu ', el('b', null, 'Fichier'), ', puis ', el('b', null, 'Ajouter au Dock'), '.'))));
  }
  return blocs;
}
