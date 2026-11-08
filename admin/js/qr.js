// Code QR en SVG (pour ajouter le code de vérification depuis un autre appareil).
import qrcode from './vendor/qrcode.mjs';
import { sv } from './outils.js';

export function qrSvg(texte, marge = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();
  const n = qr.getModuleCount(), t = n + marge * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + marge} ${r + marge}h1v1h-1z`;
  const svg = sv('svg', { viewBox: `0 0 ${t} ${t}`, role: 'img', 'shape-rendering': 'crispEdges',
    'aria-label': 'Code QR à scanner avec ton appli de codes' });
  svg.append(sv('rect', { width: t, height: t, fill: '#FFFFFF' }), sv('path', { d, fill: '#1F2937' }));
  return svg;
}
