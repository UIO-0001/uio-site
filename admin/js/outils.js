// Petits outils partagés par tout l'admin : DOM sans innerHTML, nombres, dates.
export const FUSEAU = 'America/Toronto';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const lire = (stock, cle) => { try { return window[stock].getItem(cle); } catch (e) { return null; } };
export const ecrire = (stock, cle, v) => { try { v == null ? window[stock].removeItem(cle) : window[stock].setItem(cle, v); } catch (e) { /* stockage bloqué */ } };

// Construit un élément sans jamais passer par innerHTML : le texte reste du texte.
// « style » passe par le CSSOM (permis par la règle CSP), jamais par l'attribut.
export function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e != null && e !== false) n.append(e.nodeType ? e : String(e));
  return n;
}
export function sv(tag, attrs, ...enfants) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  for (const e of enfants.flat()) if (e != null) n.append(e.nodeType ? e : String(e));
  return n;
}
export const icone = (id, cls) => { const s = sv('svg', { 'aria-hidden': 'true', class: cls }); s.append(sv('use', { href: '#' + id })); return s; };
export const vider = (n, ...enfants) => n.replaceChildren(...enfants.flat().filter(Boolean));

// Nombres, dates et durées à la québécoise
export const nombre = (n, d = 0) => Number(n || 0).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pluriel = (n, un, plus) => `${nombre(n, Number.isInteger(n) ? 0 : 1)} ${Math.abs(n) >= 2 ? plus : un}`;
// Pas de coupure de ligne dans « 14 h 00 », « 99 $ », « 15 % » ni « 3 min »
export const insecable = t => String(t).replace(/(\d)[  ](\$|%|h\b|min\b|ms\b|s\b|j\b)/g, '$1 $2').replace(/\b(h) (\d)/g, '$1 $2');
export const heure = d => insecable(d.toLocaleTimeString('fr-CA', { timeZone: FUSEAU, hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' '));
export const jourLong = d => d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'long' });
export const jourSemaine = d => d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, weekday: 'long' });
export const ymd = d => d.toLocaleDateString('en-CA', { timeZone: FUSEAU });
export const heureLocale = d => Number(d.toLocaleString('en-CA', { timeZone: FUSEAU, hour: 'numeric', hourCycle: 'h23' }));
export const majuscule = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const date = v => { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d) ? null : d; };

export function relatif(d, m = new Date()) {
  const s = Math.round((d - m) / 1000), abs = Math.abs(s), passe = s <= 0;
  const jour = ymd(d), auj = ymd(m), demain = ymd(new Date(m.getTime() + 864e5)), hier = ymd(new Date(m.getTime() - 864e5));
  if (abs < 45) return passe ? 'à l’instant' : 'dans un instant';
  if (abs < 3600) { const n = Math.max(1, Math.round(abs / 60)); return passe ? `il y a ${n} min` : `dans ${n} min`; }
  if (jour === auj && abs < 6 * 3600) { const n = Math.round(abs / 3600); return passe ? `il y a ${n} h` : `dans ${n} h`; }
  if (jour === auj) return `aujourd’hui à ${heure(d)}`;
  if (jour === hier) return `hier à ${heure(d)}`;
  if (jour === demain) return `demain à ${heure(d)}`;
  if (abs < 6 * 864e2) return passe ? `${jourSemaine(d)} dernier` : `${jourSemaine(d)} à ${heure(d)}`;
  return d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, day: 'numeric', month: 'long' });
}
export function duree(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}
export function compteARebours(d, m = new Date()) {
  let s = Math.max(0, Math.round((d - m) / 1000));
  const j = Math.floor(s / 86400); s -= j * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const mi = Math.floor(s / 60);
  if (j) return `dans ${j} j ${h} h`;
  if (h) return `dans ${h} h ${String(mi).padStart(2, '0')}`;
  return `dans ${mi} min`;
}
export const lienTel = t => { const d = String(t || '').replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 10 ? 'tel:' + d : null; };
export const lienCourriel = c => /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(c || '') ? 'mailto:' + c : null;
export const urlSure = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
export const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Un message bref en bas de l'écran (et lu par les lecteurs d'écran)
let minuterieToast;
export function toast(msg, erreur = false) {
  const t = $('#toast');
  t.textContent = msg;
  $('#annonce').textContent = msg;
  t.classList.toggle('toast--erreur', erreur);
  t.classList.add('vu');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => t.classList.remove('vu'), erreur ? 6000 : 3200);
}
export async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); return true; }
  catch (e) {
    const zone = el('textarea', { class: 'copie-cachee', readonly: true }, texte);
    document.body.append(zone); zone.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* rien */ }
    zone.remove(); return ok;
  }
}

// Le type d'appareil, pour les mots des boutons (Face ID, l'empreinte…)
export const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const estAndroid = () => /Android/.test(navigator.userAgent);
export const estTelephone = () => estIOS() || estAndroid() || matchMedia('(pointer: coarse) and (max-width: 820px)').matches;
export const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function biometrie() {
  const ua = navigator.userAgent;
  // e : l'accord au féminin (« l’empreinte est activée », « Face ID est activé »)
  if (/iPhone|iPod/.test(ua)) return { nom: 'Face ID', icone: 'i-visage', e: '' };
  if (estIOS()) return { nom: 'Face ID ou Touch ID', icone: 'i-visage', e: '' };
  if (/Macintosh/.test(ua)) return { nom: 'Touch ID', icone: 'i-empreinte', e: '' };
  if (/Android/.test(ua)) return { nom: 'l’empreinte', icone: 'i-empreinte', e: 'e' };
  if (/Windows/.test(ua)) return { nom: 'Windows Hello', icone: 'i-visage', e: '' };
  return { nom: 'une clé d’accès', icone: 'i-cle', e: 'e' };
}
