// Tableau de bord : appels de l'agent répondeur, demandes, audits, serveur, site, offre.
import { $, $$, el, sv, icone, vider, nombre, pluriel, insecable, heure, jourLong, majuscule, date, relatif,
  duree, compteARebours, lienTel, lienCourriel, urlSure, toast, lire, ecrire, heureLocale, FUSEAU } from './outils.js';
import { E, BACKEND, DEPOT, SITE, TITRE } from './etat.js';
import { dureeHM } from './formes.js';
import { api, sessionActuelle } from './api.js';
import { htmlInerte } from './confiance.js';
import { montrer } from './navigation.js';

// Le prénom seul (« Alex » dans « Alex Tremblay »), pour dire bonjour
export const prenom = nom => String(nom || '').trim().split(/\s+/)[0] || '';
export function salutation(m = new Date()) {
  const h = heureLocale(m);
  const mot = h < 5 ? 'Encore debout' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  return (nom = '') => `${mot}${nom ? `, ${nom}` : ''}${h < 5 ? ' ?' : '.'}`;
}

export const gros = (n, libelle, ...phrase) => el('div', { class: 'gros' },
  el('p', { class: 'gros__ligne' }, el('b', null, nombre(n)), el('span', null, libelle)),
  phrase.length ? el('p', null, phrase.map(m => Array.isArray(m) ? el('b', null, m[0]) : m)) : null);


export async function chargerTableau(frais = false) {
  E.lecture = true; rendreDirect();
  $$('#vue-tableau .carte').forEach(c => E.tableau && c.classList.add('lit'));
  try {
    const avant = E.tableau;
    E.tableau = await api('/portal/admin/tableau' + (frais ? '?frais=1' : ''), { delai: 80000 });
    E.tableauErreur = ''; E.majTableau = Date.now();
    nouveautes(avant, E.tableau);
  } catch (e) {
    if (e.statut === 401) return;
    E.tableauErreur = e.statut === 404 ? 'pas-encore' : e.message;
  } finally {
    E.lecture = false;
    $$('#vue-tableau .lit').forEach(c => c.classList.remove('lit'));
    rendreTableau();
  }
}

// Ce qui est arrivé depuis la dernière lecture : un toast, une pastille « Nouveau »
// pendant 10 minutes, et le nombre dans le titre de l'onglet s'il est caché.
const listeDe = (src, cle) => (src && src.disponible && Array.isArray(src[cle])) ? src[cle] : null;
const cleAppel = a => 'a' + a.debut;
const cleDemande = d => 'd' + d.date + d.nom;
function nouveautes(avant, apres) {
  if (!avant || !apres) return;
  const recents = (src, cle, champ) => {
    const a = listeDe(avant[src], cle), b = listeDe(apres[src], cle);
    if (!a || !b) return [];
    const max = Math.max(0, ...a.map(x => +date(x[champ]) || 0));
    return b.filter(x => (+date(x[champ]) || 0) > max);
  };
  const appels = recents('appels', 'derniers', 'debut');
  const demandes = recents('demandes', 'dernieres', 'date');
  const ecart = (avant.appels && apres.appels && avant.appels.mois && apres.appels.mois) ? apres.appels.mois.appels - avant.appels.mois.appels : 0;
  const nbAppels = Math.max(appels.length, ecart > 0 ? ecart : 0);
  const t = Date.now();
  appels.forEach(a => E.neufs.set(cleAppel(a), t));
  demandes.forEach(d => E.neufs.set(cleDemande(d), t));
  const morceaux = [];
  if (nbAppels === 1 && appels.length === 1) morceaux.push(appels[0].de && appels[0].de !== 'Test dans Retell' ? `Nouvel appel de ${appels[0].de}` : 'Nouvel appel');
  else if (nbAppels > 1) morceaux.push(`${nbAppels} nouveaux appels`);
  if (demandes.length === 1) morceaux.push(`Nouvelle demande de ${demandes[0].nom || 'quelqu’un'}`);
  else if (demandes.length > 1) morceaux.push(`${demandes.length} nouvelles demandes`);
  if (!morceaux.length) return;
  toast(morceaux.join(' · ') + '.');
  E.annonce = Date.now();
  if (document.visibilityState !== 'visible') {
    E.nonVus += nbAppels + demandes.length;
    document.title = `(${E.nonVus}) ${TITRE}`;
  }
}
const estNeuf = cle => { const t = E.neufs.get(cle); return !!t && Date.now() - t < 10 * 60e3; };
export const pastilleNeuf = cle => estNeuf(cle) ? el('span', { class: 'pastille-neuf' }, 'Nouveau') : null;

export function chargerPings() {
  try { const p = JSON.parse(lire('sessionStorage', 'uio-admin-pouls') || '[]'); if (Array.isArray(p)) E.pings = p.slice(-40); } catch (e) {}
}
export async function ping(delai = 15000) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), delai);
  const t0 = performance.now(), quand = Date.now();
  let ms = null;
  try {
    const r = await fetch(BACKEND + '/', { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
    if (r.ok) ms = Math.round(performance.now() - t0);
  } catch (e) {} finally { clearTimeout(minuterie); }
  E.pings.push({ t: quand, ms });
  E.pings = E.pings.slice(-40);
  ecrire('sessionStorage', 'uio-admin-pouls', JSON.stringify(E.pings));
  rendrePouls(true); rendreDirect(); rendreBonjour();
  return ms != null;
}
export async function reveiller() {
  if (E.reveil) return;
  E.reveil = Date.now();
  const tic = setInterval(() => rendrePouls(), 1000);
  rendrePouls();
  const ok = await ping(95000);
  const secondes = Math.round((Date.now() - E.reveil) / 1000);
  clearInterval(tic); E.reveil = 0; rendrePouls();
  if (ok) { toast(`Le serveur est réveillé (${secondes} s).`); chargerTableau(); document.dispatchEvent(new CustomEvent('uio:reveil')); }
  else toast('Le serveur ne répond toujours pas. Regarde Render.', true);
}

// GitHub (dépôt public) : requêtes conditionnelles, un 304 ne compte pas dans la limite de l'API.
async function gh(chemin) {
  const cle = 'uio-admin-gh:' + chemin;
  let cache = null;
  try { cache = JSON.parse(lire('sessionStorage', cle)); } catch (e) {}
  const entetes = { Accept: 'application/vnd.github+json' };
  if (cache && cache.etag) entetes['If-None-Match'] = cache.etag;
  const r = await fetch(`https://api.github.com/repos/${DEPOT}${chemin}`, { headers: entetes });
  if (r.status === 304 && cache) return cache.data;
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const data = await r.json();
  ecrire('sessionStorage', cle, JSON.stringify({ etag: r.headers.get('ETag'), data }));
  return data;
}
export async function chargerGithub(force = false) {
  if (!force && Date.now() - (E.githubLu || 0) < 60e3) return;
  E.githubLu = Date.now();
  try {
    const [commits, runs] = await Promise.all([gh('/commits?per_page=15'), gh('/actions/runs?per_page=1')]);
    E.github = { commits: Array.isArray(commits) ? commits : [], run: ((runs && runs.workflow_runs) || [])[0] || null };
    E.githubErreur = '';
  } catch (e) { E.githubErreur = 'GitHub ne répond pas pour le moment.'; }
  rendreSite();
}

// L'offre est lue sur la page d'accueil elle-même : quand le site change, cette carte suit.
export async function chargerOffre() {
  const texte = n => (n ? insecable(n.textContent.replace(/\s+/g, ' ').trim()) : '');
  try {
    const r = await fetch(SITE, { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    // Document inerte (aucun script, aucune image) ; ses styles sont retirés avant la lecture,
    // sinon la règle CSP de l'admin les signale comme des styles « en ligne ».
    const brut = (await r.text()).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, '');
    const doc = new DOMParser().parseFromString(htmlInerte(brut), 'text/html');
    const forfaits = $$('.forfait[data-nom]', doc).map(f => {
      const depart = f.querySelector('.forfait__depart');
      const valeurs = depart ? $$('.forfait__valeur', depart).map(texte) : [];
      const seul = depart ? depart.cloneNode(true) : null;
      if (seul) $$('.forfait__valeur', seul).forEach(s => s.remove());
      return { nom: texte(f.querySelector('h3')) || f.dataset.nom, vedette: f.classList.contains('forfait--vedette'),
               prix: texte(f.querySelector('.forfait__prix b')), periode: texte(f.querySelector('.forfait__prix span')),
               pour: texte(f.querySelector('.forfait__pour')), depart: texte(seul), valeurs,
               minutes: texte(f.querySelector('li.minutes')) };
    });
    const modules = $$('table.modules tbody tr', doc).map(tr => {
      const cellules = $$('td', tr);
      return { nom: texte(tr.querySelector('td b')), detail: texte(tr.querySelector('td span')), mois: texte(cellules[1]), depart: texte(cellules[2]) };
    }).filter(m => m.nom);
    const extras = $$('.extras p', doc).map(texte).filter(Boolean);
    if (!forfaits.length) throw new Error();
    E.offre = { forfaits, modules, extras, lu: Date.now() };
    E.offreErreur = '';
  } catch (e) { E.offreErreur = 'Impossible de lire l’offre sur le site pour le moment.'; }
  rendreOffre();
}

export function rendreTableau() { rendreBonjour(); rendreDirect(); rendrePouls(); rendreAppels(); rendreDemandes(); rendreAudits(); rendreChatbot(); rendreRaccourcis(); }

const dernierPing = () => E.pings[E.pings.length - 1];
export function etatServeur() {
  const p = dernierPing();
  if (!p) return 'attente';
  if (p.ms == null) return 'panne';
  return p.ms > 1500 ? 'lent' : 'ok';
}
export const source = nom => (E.tableau && E.tableau[nom]) || null;
function indisponible(nom, quoi) {
  if (E.tableauErreur === 'pas-encore') return el('p', { class: 'vide' }, `${quoi} s’afficheront ici dès que le serveur aura reçu la mise à jour du tableau de bord.`);
  if (E.tableauErreur && !E.tableau) return el('p', { class: 'vide' }, E.tableauErreur);
  const s = source(nom);
  if (!s) return el('p', { class: 'vide' }, 'Lecture en cours…');
  if (!s.disponible) return el('p', { class: 'vide' }, `${quoi} : indisponible pour le moment (${s.raison || 'raison inconnue'}).`);
  return null;
}

// Ce qui presse côté argent : factures en retard, crédits bas ou épuisés (sans répéter l'alerte des appels)
function alertesArgent(alerteAppels) {
  const a = E.argent;
  if (!a || !a.resume) return [];
  const c = a.credits || {}, rt = c.retell || {}, tw = c.twilio || {}, oa = c.openai || {};
  const liste = [];
  if (a.resume.en_retard) liste.push(pluriel(a.resume.en_retard, 'facture en retard', 'factures en retard'));
  if (!/retell/i.test(alerteAppels)) {
    if (rt.etat === 'epuise') liste.push('crédit Retell épuisé');
    else if (rt.alerte) liste.push('crédit Retell bas');
  }
  if (tw.alerte) liste.push('crédit Twilio bas');
  if (oa.etat === 'epuise') liste.push('crédit OpenAI épuisé, le chatbot ne répond plus');
  else if (oa.etat === 'cle_refusee') liste.push('clé OpenAI refusée');
  return liste;
}

// L'équipe : les tâches qui attendent la personne, et son chrono s'il tourne
function morceauxEquipe(b) {
  const q = E.equipe;
  if (!q || !q.taches) return [];
  const moi = q.moi;
  const miennes = q.taches.filter(t => (t.statut === 'a_faire' || t.statut === 'en_cours') && (t.pour === moi || t.pour === 'tous'));
  const m = [];
  if (miennes.length) {
    const urgentes = miennes.filter(t => t.priorite === 'urgente').length;
    m.push(b(pluriel(miennes.length, 'tâche', 'tâches')), ' pour toi');
    if (urgentes) m.push(', dont ', el('b', { class: 'attention' }, pluriel(urgentes, 'urgente', 'urgentes')));
    m.push(' (', el('button', { class: 'lien-texte', type: 'button', onclick: () => montrer('equipe') }, 'voir l’équipe'), '). ');
  }
  const p = ((q.heures && q.heures.personnes) || []).find(x => x.identifiant === moi);
  if (p && p.en_cours) m.push('Ton chrono tourne depuis ', b(dureeHM((Date.now() - Date.parse(p.en_cours.debut)) / 60000)), '. ');
  return m;
}

export function rendreBonjour() {
  const s = sessionActuelle();
  if (!s) return;
  const m = new Date();
  $('#bonjour-titre').textContent = salutation(m)(prenom(s.admin.nom));
  $('#bonjour-date').textContent = `${majuscule(jourLong(m))} · ${heure(m)}`;

  const b = t => el('b', null, t);
  const morceaux = [];
  const appels = source('appels'), demandes = source('demandes'), audits = source('rendez_vous');
  const alerteAppels = appels && appels.disponible && appels.alerte ? appels.alerte : '';
  const argent = alertesArgent(alerteAppels);
  if (alerteAppels || argent.length) {
    morceaux.push(el('b', { class: 'attention' }, 'Attention : '));
    if (alerteAppels) morceaux.push(alerteAppels.replace(/\.$/, '') + '. ');
    if (argent.length) {
      const liste = argent.length > 1 ? `${argent.slice(0, -1).join(', ')} et ${argent[argent.length - 1]}` : argent[0];
      morceaux.push(alerteAppels ? `Aussi : ${liste}` : majuscule(liste), ' (',
        el('button', { class: 'lien-texte', type: 'button', onclick: () => montrer('argent') }, 'voir l’argent'), '). ');
    }
  }
  morceaux.push(...morceauxEquipe(b));
  const faits = [];
  if (appels && appels.disponible) faits.push([b(pluriel(appels.aujourdhui, 'appel', 'appels')), ' aujourd’hui']);
  if (demandes && demandes.disponible) faits.push([b(pluriel(demandes.semaine, 'demande', 'demandes')), ' du chatbot cette semaine']);
  if (audits && audits.disponible) {
    const p = audits.prochains && audits.prochains[0] && date(audits.prochains[0].debut);
    faits.push(p ? ['prochain audit ', b(relatif(p))] : ['aucun audit réservé']);
  }
  if (faits.length) {
    faits.forEach((f, i) => { if (i) morceaux.push(i === faits.length - 1 ? ' et ' : ', '); morceaux.push(...f); });
    morceaux.push('. ');
  } else if (E.clientsLus) {
    morceaux.push(b(pluriel(E.clients.length, 'client', 'clients')), ' dans l’espace client. ');
  }
  const etat = etatServeur(), p = dernierPing();
  if (etat === 'ok' || etat === 'lent') morceaux.push('Le serveur répond en ', b(p.ms >= 1000 ? `${nombre(p.ms / 1000, 1)} s` : `${p.ms} ms`), '.');
  else if (etat === 'panne') morceaux.push(b('Le serveur ne répond pas'), ' : il dort peut-être.');
  // Redessinée toutes les 15 s : le bouton qui avait le focus le retrouve
  const avant = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#bonjour-phrase button') : null;
  const quoi = avant ? avant.textContent : '';
  if (morceaux.length) vider($('#bonjour-phrase'), morceaux);
  if (quoi) { const b = $$('#bonjour-phrase button').find(x => x.textContent === quoi); if (b) b.focus({ preventScroll: true }); }
}

export function rendreDirect() {
  const d = $('#direct'), t = $('#direct-texte');
  const etat = etatServeur();
  d.dataset.etat = E.lecture ? 'attente' : etat;
  if (E.lecture) t.textContent = 'Lecture…';
  else if (etat === 'panne') t.textContent = 'Serveur injoignable';
  else if (E.majTableau) t.textContent = `En direct · ${relatif(new Date(E.majTableau)).replace('à l’instant', 'à jour')}`;
  else t.textContent = etat === 'attente' ? 'Lecture…' : 'En direct';
}

// Le pouls : le temps de réponse du serveur à chaque essai (toutes les 30 secondes).
export function rendrePouls(nouveau = false) {
  const etat = etatServeur(), p = dernierPing();
  const pastille = {
    ok: ['etat--ok', `Éveillé · ${p && p.ms} ms`],
    lent: ['etat--lent', `Lent · ${p && p.ms != null ? nombre(p.ms / 1000, 1) : ''} s`],
    panne: ['etat--panne', 'Endormi ou injoignable'],
    attente: ['', 'Premier essai…']
  }[etat];
  const haut = [el('span', { class: 'etat ' + pastille[0] }, pastille[1])];
  if (E.reveil) haut.push(el('span', { class: 'note' }, `Réveil en cours… ${Math.round((Date.now() - E.reveil) / 1000)} s (jusqu’à une minute)`));
  else if (etat === 'panne') haut.push(el('button', { class: 'btn btn--petit', type: 'button', onclick: reveiller }, 'Réveiller le serveur'));
  vider($('#pouls-etat'), haut);

  dessinerPouls($('#pouls-graphe'), nouveau);

  const serveur = source('serveur');
  const morceaux = [];
  const essais = E.pings.filter(x => x.ms != null);
  if (essais.length > 1) morceaux.push(`Moyenne ${Math.round(essais.reduce((s, x) => s + x.ms, 0) / essais.length)} ms sur les ${essais.length} derniers essais`);
  if (serveur) {
    const dem = date(serveur.demarre_a);
    if (dem) morceaux.push(`démarré ${relatif(dem)}`);
    if (serveur.version) morceaux.push(`version ${serveur.version}`);
    if (serveur.simulation) morceaux.push('mode simulation');
  }
  $('#pouls-note').textContent = morceaux.length ? majuscule(morceaux.join(' · ')) + '.' : 'Un essai toutes les 30 secondes tant que la page est ouverte.';
}

function dessinerPouls(boite, nouveau) {
  const W = Math.max(240, boite.clientWidth || 320), H = 120, haut = 10, bas = 22, gauche = 2, droite = 54;
  const points = E.pings;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });
  const valides = points.filter(x => x.ms != null);
  const max = Math.max(600, ...valides.map(x => x.ms)) * 1.15;
  const y = v => haut + (H - haut - bas) * (1 - v / max);
  const n = Math.max(points.length, 2);
  const x = i => gauche + (W - gauche - droite) * (points.length < 2 ? 1 : i / (n - 1));
  // Repères : une ligne à 0 et une à une valeur ronde
  const repere = max > 2400 ? 2000 : max > 1200 ? 1000 : 500;
  svg.append(sv('line', { class: 'grille-l', x1: gauche, x2: W - droite, y1: y(0), y2: y(0) }));
  svg.append(sv('line', { class: 'grille-l', x1: gauche, x2: W - droite, y1: y(repere), y2: y(repere) }));
  svg.append(sv('text', { class: 'axe', x: W - droite + 8, y: y(repere) + 4 }, repere >= 1000 ? `${repere / 1000} s` : `${repere} ms`));
  if (points.length) {
    const premier = date(points[0].t), dernier = date(points[points.length - 1].t);
    if (premier && dernier && points.length > 1) {
      svg.append(sv('text', { class: 'axe', x: gauche, y: H - 4 }, heure(premier)));
      svg.append(sv('text', { class: 'axe', x: W - droite, y: H - 4, 'text-anchor': 'end' }, heure(dernier)));
    }
  }
  // Morceaux de ligne : un essai sans réponse coupe la ligne
  const morceaux = []; let courant = [];
  points.forEach((p, i) => { if (p.ms == null) { if (courant.length) morceaux.push(courant); courant = []; } else courant.push([x(i), y(p.ms)]); });
  if (courant.length) morceaux.push(courant);
  morceaux.forEach(m => {
    if (m.length > 1) {
      const d = m.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
      svg.append(sv('path', { class: 'pouls__aire', d: `${d} L${m[m.length - 1][0].toFixed(1)},${y(0)} L${m[0][0].toFixed(1)},${y(0)} Z` }));
      svg.append(sv('path', { class: 'pouls__ligne', d }));
    }
  });
  const p = dernierPing();
  if (p && p.ms != null) {
    const cx = x(points.length - 1), cy = y(p.ms);
    if (nouveau) svg.append(sv('circle', { class: 'pouls__onde', cx, cy, r: 5 }));
    svg.append(sv('circle', { class: 'pouls__point', cx, cy, r: 5 }));
    svg.append(sv('text', { class: 'valeur', x: cx + 10, y: Math.max(12, cy - 8) }, `${p.ms} ms`));
  }
  if (points.length < 3) svg.append(sv('text', { class: 'axe', x: gauche, y: (y(repere) + y(0)) / 2 + 4 }, 'La courbe se remplit : un essai toutes les 30 secondes.'));
  const ok = valides.length;
  svg.setAttribute('aria-label', points.length
    ? `Temps de réponse du serveur : ${p && p.ms != null ? p.ms + ' millisecondes au dernier essai' : 'pas de réponse au dernier essai'}, ${ok} réponses sur ${points.length} essais.`
    : 'Temps de réponse du serveur : premier essai en cours.');
  // Curseur et info-bulle : le curseur trouve l'essai le plus proche
  const curseur = sv('line', { class: 'pouls__curseur', y1: haut, y2: y(0), visibility: 'hidden' });
  svg.append(curseur);
  const bulle = el('div', { class: 'infobulle', hidden: true });
  svg.addEventListener('pointermove', ev => {
    if (!points.length) return;
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(points.length - 1, Math.round((px - gauche) / ((W - gauche - droite) / (n - 1)))));
    const pt = points[i], cx = x(i);
    curseur.setAttribute('x1', cx); curseur.setAttribute('x2', cx); curseur.setAttribute('visibility', 'visible');
    vider(bulle, el('b', null, pt.ms != null ? `${pt.ms} ms` : 'Pas de réponse'), heure(new Date(pt.t)));
    bulle.hidden = false;
    bulle.style.left = `${(cx / W) * r.width}px`;
    bulle.style.top = `${((pt.ms != null ? y(pt.ms) : y(0)) / H) * r.height}px`;
  });
  svg.addEventListener('pointerleave', () => { curseur.setAttribute('visibility', 'hidden'); bulle.hidden = true; });
  vider(boite, svg, bulle);
}

function rendreAppels() {
  const boite = $('#appels');
  const s = source('appels');
  if (s && s.lien_retell && urlSure(s.lien_retell)) $('#lien-retell').href = s.lien_retell;
  const manque = indisponible('appels', 'Les appels de l’agent répondeur');
  if (manque) return vider(boite, manque);
  const blocs = [];
  if (s.alerte) blocs.push(el('div', { class: 'alerte', role: 'alert' }, el('b', null, 'Attention'), s.alerte));
  const mo = s.mois || {};
  blocs.push(gros(s.aujourdhui, s.aujourdhui >= 2 ? 'appels aujourd’hui' : 'appel aujourd’hui',
    'Ce mois-ci : ', [pluriel(mo.appels, 'appel', 'appels')], ', ', [pluriel(Math.round((mo.minutes || 0) * 10) / 10, 'minute', 'minutes')],
    ' et ', [`${nombre(mo.cout_usd, 2)} $ US`], ' chez Retell.'));
  if (Array.isArray(s.par_jour) && s.par_jour.length) blocs.push(barresParJour(s.par_jour));
  if (Array.isArray(s.derniers) && s.derniers.length) {
    blocs.push(el('ul', { class: 'liste', 'aria-label': 'Derniers appels' }, s.derniers.map(a => {
      const quand = date(a.debut);
      const tel = lienTel(a.de);
      return el('li', null,
        el('div', { class: 'ligne' },
          tel ? el('a', { class: 'ligne__titre tel', href: tel }, a.de) : el('span', { class: 'ligne__titre' }, a.de || 'Numéro inconnu'),
          pastilleNeuf(cleAppel(a)),
          el('span', { class: 'ligne__meta' }, duree(a.duree_s)),
          quand && el('time', { class: 'ligne__quand', datetime: a.debut, title: `${jourLong(quand)} à ${heure(quand)}` }, relatif(quand))),
        a.resume ? el('p', { class: 'resume' }, a.resume) : null,
        el('div', { class: 'ligne' },
          el('span', { class: 'appel__agent' }, [a.agent, a.fin].filter(Boolean).join(' · ')),
          urlSure(a.lien) && el('a', { class: 'lien ml-auto', href: a.lien, target: '_blank', rel: 'noopener' }, 'Écouter')));
    })));
  } else blocs.push(el('p', { class: 'vide' }, 'Pas encore d’appel ce mois-ci.'));
  if (s.complet === false) blocs.push(el('p', { class: 'note' }, 'Plus de 1 000 appels ce mois-ci : les totaux comptent les 1 000 plus récents.'));
  vider(boite, blocs);
}

// Appels par jour du mois : une colonne par jour, la valeur au sommet de la plus haute.
let observateurBarres = null;
function barresParJour(jours) {
  const boite = el('div', { class: 'graphe barres' });
  const total = jours.reduce((s, j) => s + j.appels, 0);
  const tableau = el('table', { class: 'sr' }, el('caption', null, 'Appels par jour ce mois-ci'),
    el('tr', null, el('th', null, 'Jour'), el('th', null, 'Appels'), el('th', null, 'Minutes')),
    jours.map(j => el('tr', null, el('td', null, j.jour), el('td', null, String(j.appels)), el('td', null, String(j.minutes)))));
  let largeurDessinee = -1;
  const dessiner = () => {
    if (boite.clientWidth === largeurDessinee) return;
    largeurDessinee = boite.clientWidth;
    const W = Math.max(260, boite.clientWidth || 520), H = 112, haut = 18, bas = 20;
    const n = jours.length, pas = W / n, largeur = Math.max(3, Math.min(24, pas - 2));
    const max = Math.max(1, ...jours.map(j => j.appels));
    const hauteur = v => (H - haut - bas) * v / max;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': `Appels par jour ce mois-ci : ${total} au total, ${max} au plus en une journée.` });
    svg.append(sv('line', { class: 'grille-l', x1: 0, x2: W, y1: H - bas + .5, y2: H - bas + .5 }));
    const bulle = el('div', { class: 'infobulle', hidden: true });
    const iMax = jours.findIndex(j => j.appels === max);
    jours.forEach((j, i) => {
      const cx = pas * i + pas / 2, hb = hauteur(j.appels), x0 = cx - largeur / 2, y0 = H - bas - hb;
      const r = Math.min(4, hb, largeur / 2);
      if (j.appels > 0) {
        const d = `M${x0},${H - bas} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} L${x0 + largeur - r},${y0} Q${x0 + largeur},${y0} ${x0 + largeur},${y0 + r} L${x0 + largeur},${H - bas} Z`;
        svg.append(sv('path', { class: 'barre', d, 'data-i': i }));
      }
      const jourNo = Number(j.jour.slice(8));
      if (jourNo === 1 || jourNo % 7 === 1 || i === n - 1) svg.append(sv('text', { class: 'axe', x: cx, y: H - 5, 'text-anchor': 'middle' }, i === n - 1 ? 'auj.' : String(jourNo)));
      const zone = sv('rect', { x: pas * i, y: 0, width: pas, height: H - bas, fill: 'transparent' });
      zone.addEventListener('pointerenter', () => {
        $$('.barre', svg).forEach(b => b.classList.toggle('actif', b.dataset.i === String(i)));
        const d = date(j.jour + 'T12:00:00');
        vider(bulle, el('b', null, pluriel(j.appels, 'appel', 'appels')), `${d ? majuscule(d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })) : j.jour} · ${nombre(j.minutes, j.minutes % 1 ? 1 : 0)} min`);
        bulle.hidden = false;
        const rb = svg.getBoundingClientRect();
        bulle.style.left = `${(cx / W) * rb.width}px`;
        bulle.style.top = `${((H - bas - hb) / H) * rb.height}px`;
      });
      svg.append(zone);
    });
    if (max > 0 && iMax >= 0 && jours[iMax].appels > 0) {
      const cx = pas * iMax + pas / 2;
      svg.append(sv('text', { class: 'valeur', x: cx, y: H - bas - hauteur(max) - 6, 'text-anchor': 'middle' }, String(max)));
    }
    svg.addEventListener('pointerleave', () => { bulle.hidden = true; $$('.barre', svg).forEach(b => b.classList.remove('actif')); });
    vider(boite, svg, bulle, tableau);
  };
  if (observateurBarres) observateurBarres.disconnect();
  observateurBarres = new ResizeObserver(() => dessiner());
  observateurBarres.observe(boite);
  return boite;
}

function rendreDemandes() {
  const boite = $('#demandes');
  const manque = indisponible('demandes', 'Les demandes du chatbot');
  if (manque) return vider(boite, manque);
  const s = source('demandes');
  const blocs = [gros(s.semaine, s.semaine >= 2 ? 'demandes en 7 jours' : 'demande en 7 jours',
    [nombre(s.mois)], ' sur les 30 derniers jours, ', [nombre(s.total)], ' depuis le début.')];
  if (!s.dernieres || !s.dernieres.length) blocs.push(el('p', { class: 'vide' }, 'Aucune demande pour l’instant. Elles arrivent ici dès qu’un visiteur laisse ses coordonnées au chatbot.'));
  else blocs.push(el('ul', { class: 'liste', 'aria-label': 'Dernières demandes' }, s.dernieres.map(d => {
    const quand = date(d.date);
    const tel = lienTel(d.telephone), courriel = lienCourriel(d.courriel);
    const details = [d.entreprise, d.besoin].filter(Boolean).join(' · ');
    return el('li', null,
      el('div', { class: 'ligne' },
        el('span', { class: 'ligne__titre' }, d.nom || 'Sans nom'),
        pastilleNeuf(cleDemande(d)),
        details && el('span', { class: 'ligne__meta' }, details),
        quand && el('time', { class: 'ligne__quand', datetime: d.date, title: `${jourLong(quand)} à ${heure(quand)}` }, relatif(quand))),
      d.resume ? el('p', { class: 'resume' }, d.resume) : null,
      d.moment_rappel ? el('p', { class: 'ligne__meta' }, `Rappel souhaité : ${d.moment_rappel}`) : null,
      (tel || courriel) && el('div', { class: 'actions' },
        tel && el('a', { class: 'puce tel', href: tel }, `Appeler ${d.telephone}`),
        courriel && el('a', { class: 'puce', href: courriel }, 'Écrire')));
  })));
  vider(boite, blocs);
}

// Le bouton « Agenda » : le serveur donne le lien de l'agenda des audits dans le compte
// Google de l'agence. Sans lien (ancien serveur), il garde l'adresse générale.
function lienAgenda() {
  const a = $('#carte-audits .carte__tete a.lien');
  const s = source('rendez_vous');
  const lien = s && typeof s.lien === 'string' && s.lien.startsWith('https://calendar.google.com/') ? s.lien : '';
  if (a && lien && a.getAttribute('href') !== lien) a.setAttribute('href', lien);
}

export function rendreAudits() {
  lienAgenda();
  const boite = $('#audits');
  const manque = indisponible('rendez_vous', 'Les audits réservés');
  if (manque) return vider(boite, manque);
  const s = source('rendez_vous');
  const m = new Date();
  const prochains = (s.prochains || []).map(a => ({ ...a, d: date(a.debut) })).filter(a => a.d && a.d.getTime() > m.getTime() - 15 * 60e3);
  if (!prochains.length) return vider(boite, el('p', { class: 'vide' }, 'Aucun audit réservé pour l’instant. Le chatbot en réserve à partir de 24 h d’avance.'));
  vider(boite, el('ul', { class: 'liste' }, prochains.map(a => {
    const courriel = lienCourriel(a.courriel);
    const enCours = a.d <= m;
    return el('li', null, el('div', { class: 'audit' },
      el('div', { class: 'audit__date', 'aria-hidden': 'true' },
        el('small', null, a.d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, weekday: 'short' })),
        el('b', null, a.d.toLocaleDateString('fr-CA', { timeZone: FUSEAU, day: 'numeric' }))),
      el('div', { class: 'audit__quoi' },
        el('span', { class: 'ligne__titre' }, a.nom || 'Sans nom'),
        el('span', { class: 'ligne__meta' }, `${majuscule(jourLong(a.d))} à ${heure(a.d)} · ${enCours ? 'en cours' : compteARebours(a.d, m)}`),
        courriel && el('a', { class: 'ligne__meta', href: courriel }, a.courriel))));
  })));
}

function rendreChatbot() {
  const boite = $('#chatbot');
  if (E.tableauErreur === 'pas-encore') return vider(boite, el('p', { class: 'vide' }, 'Les messages du jour s’afficheront ici avec la mise à jour du serveur.'));
  const c = source('chatbot');
  if (!c) return vider(boite, el('p', { class: 'vide' }, E.tableauErreur || 'Lecture en cours…'));
  const serveur = source('serveur');
  const dem = serveur && date(serveur.demarre_a);
  const lignes = (c.aujourdhui || []);
  const blocs = [];
  if (!lignes.length) blocs.push(el('p', { class: 'vide' }, 'Aucun message au chatbot aujourd’hui.'));
  else blocs.push(el('div', { class: 'raccourcis' }, lignes.map(l => el('div', { class: 'jauge-ligne' },
    el('span', { class: 'jauge-ligne__nom' }, l.nom),
    el('span', { class: 'jauge jauge--bleu', role: 'img', 'aria-label': `${l.messages} messages sur ${l.plafond} permis par jour` }, el('i', { style: `width:${Math.min(100, Math.max(2, 100 * l.messages / l.plafond))}%` })),
    el('b', null, nombre(l.messages))))));
  blocs.push(el('p', { class: 'note' }, `Messages envoyés à l’IA aujourd’hui, par chatbot${dem ? `, depuis le démarrage du serveur (${relatif(dem)})` : ''}. La barre montre la part du plafond quotidien.`));
  vider(boite, blocs);
}

export function rendreSite() {
  const boite = $('#site');
  if (!E.github) return vider(boite, el('p', { class: 'vide' }, E.githubErreur || 'Lecture en cours…'));
  const blocs = [];
  const run = E.github.run;
  if (run) {
    const quand = date(run.updated_at || run.created_at);
    let classe = 'etat--ok', texte = 'En ligne';
    if (run.status !== 'completed') { classe = 'etat--lent'; texte = 'Publication en cours'; }
    else if (run.conclusion !== 'success') { classe = 'etat--panne'; texte = 'Publication ratée'; }
    blocs.push(el('div', { class: 'pouls__haut' }, el('span', { class: 'etat ' + classe }, texte),
      quand && el('span', { class: 'ligne__meta' }, `publié ${relatif(quand)}`)));
  }
  // Une ligne par changement mis en ligne (fusion d'une PR), sinon par commit.
  const changements = E.github.commits.map(c => {
    const lignes = String((c.commit && c.commit.message) || '').split('\n').map(l => l.trim()).filter(Boolean);
    const fusion = /^Merge pull request #(\d+)/.exec(lignes[0] || '');
    const titre = (fusion ? (lignes[1] || lignes[0]) : (lignes[0] || '')).replace(/^(feat|fix|chore|docs|style|refactor|perf)(\(.+?\))?!?:\s*/i, '');
    return { fusion: !!fusion, titre,
             pr: fusion && fusion[1], quand: date(c.commit && c.commit.committer && c.commit.committer.date), url: c.html_url };
  });
  const fusions = changements.filter(c => c.fusion);
  const liste = (fusions.length ? fusions : changements).slice(0, 4);
  if (liste.length) blocs.push(el('ul', { class: 'liste', 'aria-label': 'Derniers changements du site' }, liste.map(c => el('li', null,
    el('a', { class: 'ligne__titre sans-soulignement', href: urlSure(c.pr ? `https://github.com/${DEPOT}/pull/${c.pr}` : c.url) || '#', target: '_blank', rel: 'noopener' }, majuscule(c.titre)),
    el('span', { class: 'ligne__meta' }, [c.pr && `#${c.pr}`, c.quand && relatif(c.quand)].filter(Boolean).join(' · '))))));
  blocs.push(el('div', { class: 'actions' },
    el('a', { class: 'puce', href: SITE, target: '_blank', rel: 'noopener' }, 'agenceuio.ca'),
    el('a', { class: 'puce', href: SITE + 'en/', target: '_blank', rel: 'noopener' }, 'Version anglaise')));
  vider(boite, blocs);
}

export function rendreOffre() {
  const boite = $('#offre');
  if (!E.offre) return vider(boite, el('p', { class: 'vide' }, E.offreErreur || 'Lecture du site…'));
  const o = E.offre;
  const blocs = [el('div', { class: 'forfaits' }, o.forfaits.map(f => el('div', { class: 'forfait' + (f.vedette ? ' forfait--vedette' : '') },
    el('h3', null, f.nom),
    el('p', { class: 'forfait__prix' }, f.prix, el('small', null, f.periode)),
    f.depart && el('p', null, f.depart),
    f.minutes && el('p', null, f.minutes),
    f.valeurs.map(v => el('p', null, v)))))];
  if (o.modules.length) blocs.push(el('table', { class: 'modules' },
    el('caption', { class: 'sr' }, 'Modules à la carte'),
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'À la carte'), el('th', { scope: 'col' }, 'Par mois'), el('th', { scope: 'col' }, 'Départ'))),
    el('tbody', null, o.modules.map(m => el('tr', null, el('td', null, m.nom), el('td', null, m.mois), el('td', null, m.depart))))));
  o.extras.forEach(t => blocs.push(el('p', { class: 'note note--fort' }, t)));
  blocs.push(el('p', { class: 'note' }, `Lu sur agenceuio.ca ${relatif(new Date(o.lu))}. Quand le site change, cette carte suit toute seule.`));
  vider(boite, blocs);
}

function rendreRaccourcis() {
  const appels = source('appels');
  const retell = (appels && urlSure(appels.lien_retell)) || 'https://dashboard.retellai.com/';
  const liens = [
    ['Retell', 'Appels, agents et crédit', retell],
    ['Twilio', 'Numéros et textos', 'https://console.twilio.com/'],
    ['Render', 'Le serveur du chatbot', 'https://dashboard.render.com/'],
    ['GitHub', 'Le code du site et du serveur', 'https://github.com/UIO-0001'],
    ['Web3Forms', 'Le formulaire du site', 'https://app.web3forms.com/'],
    ['Espace client', 'Ce que voient les clients', SITE + 'client.html']
  ];
  vider($('#raccourcis'), liens.map(([nom, quoi, href]) => el('a', { class: 'raccourci', href, target: '_blank', rel: 'noopener' },
    el('b', null, nom), el('span', null, quoi), icone('i-sortie'))));
}
