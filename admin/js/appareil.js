// Cet appareil : un identifiant au hasard gardé ici (jamais secret) et un nom lisible.
import { lire, ecrire, estInstallee } from './outils.js';

const b64u = octets => btoa(String.fromCharCode(...octets)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function nomAppareil() {
  const ua = navigator.userAgent;
  let type = 'Ordinateur';
  if (/iPhone/.test(ua)) type = 'iPhone';
  else if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) type = 'iPad';
  else if (/Android/.test(ua)) type = /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
  else if (/Macintosh/.test(ua)) type = 'Mac';
  else if (/Windows/.test(ua)) type = 'PC Windows';
  else if (/CrOS/.test(ua)) type = 'Chromebook';
  else if (/Linux/.test(ua)) type = 'Ordinateur Linux';
  let nav = '';
  if (estInstallee()) nav = 'app installée';
  else if (/EdgA?\/|Edg\//.test(ua)) nav = 'Edge';
  else if (/SamsungBrowser/.test(ua)) nav = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(ua)) nav = 'Firefox';
  else if (/CriOS|Chrome/.test(ua)) nav = 'Chrome';
  else if (/Safari/.test(ua)) nav = 'Safari';
  return nav ? `${type} · ${nav}` : type;
}

export function appareil() {
  let id = lire('localStorage', 'uio-admin-appareil');
  if (!id || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) {
    id = b64u(crypto.getRandomValues(new Uint8Array(16)));
    ecrire('localStorage', 'uio-admin-appareil', id);
  }
  return { id, nom: nomAppareil() };
}
