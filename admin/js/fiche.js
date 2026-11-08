// La fiche d'un client (le panneau qui glisse de la droite) : tout ce qu'on sait de lui au même
// endroit. Elle remplace l'ancien « avancement en % + étapes » (2026-11-08).
//  - Coordonnées et langue de ses courriels ; où en est son service ; notes internes.
//  - Son forfait et ses factures (de l'Argent), avec un rappel de paiement prêt à envoyer.
//  - Son rapport du mois : avis et mot (ce qu'il voit dans son espace), et le courriel du rapport.
//  - Ses documents, ce qu'il voit dans son espace client (note, démo, fonctionnalités, mot de
//    passe), les courriels qu'on lui a envoyés et l'historique.
// « Enregistrer » écrit la fiche, l'espace client et le rapport. Un courriel ne part jamais sans
// un clic sur son propre bouton (ou l'envoi du mois, si la fiche le demande).
import { $, icone, vider, majuscule, date, heure, toast, urlSure, lienTel, lienCourriel, ymd, FUSEAU } from './outils.js';
import { E, ESPACE_CLIENT } from './etat.js';
import { api } from './api.js';
import { montrer } from './navigation.js';
import { ouvrirPanneau, fermerPanneau } from './panneau.js';
import { occuper } from './ui.js';
import { fr, el, Invalide, nouvelleCle, badge, champTexte, champDate, pilules, bascule, confirmations, formulaireEnLigne } from './formes.js';
import { blocRapport } from './rapport.js';
import { argent as montant, leJour, badgeFacture, chargerArgent, ouvrirAbonnement } from './argent.js';
import { chargerFiches, garderFiches, rendreClients, rendrePortail, blocMotDePasse } from './clients.js';
import { rendreEquipe } from './equipe.js';

const STATUTS = { mise_en_place: 'Mise en place', en_service: 'En service', termine: 'Terminé' };
const GENRES = { mise_en_place: 'attente', en_service: '', termine: 'neutre' };
const CHAMPS = ['contact', 'courriel', 'telephone', 'adresse', 'site', 'metier', 'langue', 'statut', 'depuis', 'rapport_auto', 'notes_internes'];
const COURRIEL_RE = /^[^\s@<>"'(),;:]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const SITE_RE = /^(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d{2,5})?(?:[/?#][^\s<>"']*)?$/;
const NOTES_MAX = 2000, NOTE_CLIENT_MAX = 1000;
const SORTES = { rappel: 'Rappel de paiement', rapport: 'Rapport du mois' };
const RESULTATS = { envoye: ['Envoyé', ''], echec: ['Pas parti', 'alerte'], vide: ['Rien à envoyer', 'neutre'] };

// ─── Ce que les autres écrans lisent ───────────────────────────────────────
export const nomStatut = s => ((E.fiches && E.fiches.statuts) || STATUTS)[s] || STATUTS.en_service;
export const badgeStatut = s => badge(nomStatut(s), GENRES[s] ?? 'neutre');

// La fiche du serveur ; sinon (pas encore lue) celle de départ : l'ancien avancement donne le statut
export function ficheDe(c) {
  const id = String(c.client_id);
  const f = E.fiches && E.fiches.fiches ? E.fiches.fiches[id] : null;
  if (f) return f;
  const pct = parseInt(c.progress, 10) || 0;
  return { client: id, contact: '', courriel: '', telephone: '', adresse: '', site: '', metier: '', langue: 'fr',
    statut: pct >= 100 ? 'en_service' : 'mise_en_place', depuis: '', rapport_auto: false, rapport_auto_depuis: '',
    notes_internes: '', ecrite: false, depuis_prospect: false, courriels: [], abonnements: [], prospect: null };
}
export const documentsDe = id => ((E.fiches && E.fiches.documents) || []).filter(d => d.client === String(id));
export const abonnementDe = f => (f.abonnements || [])[0] || null;
// Ses factures à encaisser (dues ou en retard), la plus en retard d'abord
export function aEncaisser(f) {
  return (f.abonnements || []).flatMap(a => (a.factures || []).filter(x => (x.etat === 'due' || x.etat === 'en_retard') && x.reste > 0)
    .map(x => ({ ...x, abonnement: a.id }))).sort((x, y) => x.jours - y.jours);
}
// « Répondeur · 199 $ par mois · 250 min »
export function texteForfait(ab) {
  if (!ab) return '';
  return [ab.forfait_nom, `${montant(ab.total_mensuel)} par mois`, ab.minutes_incluses ? `${ab.minutes_incluses} min` : '']
    .filter(Boolean).join(' · ') + (ab.etat === 'termine' ? ' (terminé)' : '');
}

// ─── Petits outils ─────────────────────────────────────────────────────────
const hote = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return ''; } };
const chiffresTel = t => String(t || '').split(/poste|p\.|x|ext/i)[0].replace(/\D/g, '');
// « 8 nov. à 14 h 05 »
const moment = iso => { const d = date(iso); return d ? `${leJour(ymd(d))} à ${heure(d)}` : ''; };
// « Déjà envoyé : le 8 nov. à 16 h 55 (2 fois). » : deux envois de la même minute ne font qu'une ligne
function dejaEnvoye(liste) {
  const vus = [];
  for (const m of liste) {
    const t = `le ${moment(m.quand)}${m.qui ? ` par ${m.qui}` : ''}`;
    const pareil = vus.find(v => v.t === t);
    if (pareil) pareil.n++; else vus.push({ t, n: 1 });
  }
  return `Déjà envoyé : ${vus.map(v => (v.n > 1 ? `${v.t} (${v.n} fois)` : v.t)).join(', ')}.`;
}
const nettoyer = o => JSON.parse(JSON.stringify(o, (k, x) => (typeof x === 'string' ? x.trim() : x)));
// Le mois du Québec : « 2026-11 »
const moisDe = d => d.toLocaleDateString('en-CA', { timeZone: FUSEAU }).slice(0, 7);
const nomMois = cle => new Date(`${cle}-15T12:00:00Z`).toLocaleDateString('fr-CA', { timeZone: 'UTC', month: 'long' });
const moisAvant = (cle, n = 1) => { const [a, m] = cle.split('-').map(Number); const t = m - 1 - n; return `${a + Math.floor(t / 12)}-${String(((t % 12) + 12) % 12 + 1).padStart(2, '0')}`; };

// Quand le rapport partira tout seul la prochaine fois (le 2 à 10 h, le mois d'avant)
function prochainEnvoi(f, maintenant = new Date()) {
  const envoi = (E.fiches && E.fiches.envoi_du_mois) || { jour: 2, heure: 10 };
  const ici = new Date(maintenant.toLocaleString('en-US', { timeZone: FUSEAU }));
  const ceMois = moisDe(maintenant);
  const fenetre = new Date(ici); fenetre.setDate(envoi.jour); fenetre.setHours(envoi.heure, 0, 0, 0);
  const depuis = date(f.rapport_auto_depuis);
  const depuisIci = depuis ? new Date(depuis.toLocaleString('en-US', { timeZone: FUSEAU })) : null;
  const parti = (f.courriels || []).some(x => x.cle === `rapport:${f.client}:${moisAvant(ceMois)}` && (x.resultat === 'envoye' || x.resultat === 'vide'));
  if (ici < fenetre) return { quand: 'bientot', mois: moisAvant(ceMois), le: `${envoi.jour === 1 ? '1er' : envoi.jour} ${nomMois(ceMois)}` };
  const dansLaFenetre = ici.getDate() <= 7 && ici.getHours() < 20 && !parti && (!depuisIci || depuisIci < fenetre);
  if (dansLaFenetre) return { quand: 'maintenant', mois: moisAvant(ceMois) };
  const suivant = moisAvant(ceMois, -1);
  return { quand: 'bientot', mois: ceMois, le: `${envoi.jour === 1 ? '1er' : envoi.jour} ${nomMois(suivant)}` };
}

// ─── Le panneau ────────────────────────────────────────────────────────────
// options.section : la partie à montrer tout de suite ; options.rappel : { abonnement, facture } à préparer
export function ouvrirFiche(c, { section = '', rappel = null } = {}) {
  const id = String(c.client_id);
  if (E.panneau && E.panneau.modifie && E.panneau.modifie() && !(E.panneau.type === 'client' && E.panneau.id === id)) {
    toast('Enregistre ou ferme d’abord le panneau ouvert.', true);
    return;
  }
  if (E.panneau && E.panneau.type === 'client' && E.panneau.id === id) {   // déjà ouverte : on va à la bonne partie
    if (rappel) E.panneau.preparerRappel(rappel.abonnement, rappel.facture);
    else if (section) E.panneau.aller(section);
    return;
  }
  const f0 = ficheDe(c);
  const lisible = !!E.fiches;            // sans la fiche du serveur, ses champs restent gris
  const depart = {
    fiche: Object.fromEntries(CHAMPS.map(k => [k, k === 'rapport_auto' ? !!f0[k] : String(f0[k] ?? '')])),
    portail: { project_name: c.project_name || '', notes: c.notes || '', demo_url: c.demo_url || '',
      features: Object.fromEntries(E.fonctionnalites.map(x => [x.key, !!(c.features && c.features[x.key])])) }
  };
  const v = JSON.parse(JSON.stringify(depart));
  const entrees = {};
  const etat = { type: 'client', id };
  const change = () => { erreur.textContent = ''; if (etat.majPied) etat.majPied(); dessinerResume(); dessinerAuto(); };
  const rapport = blocRapport(c, () => etat.majPied && etat.majPied());
  etat.rapport = rapport;
  etat.modifie = () => JSON.stringify(nettoyer(v)) !== JSON.stringify(nettoyer(depart)) || rapport.modifie();
  const erreur = el('p', { class: 'erreur', role: 'alert' });

  // Un champ relié à v (fiche ou portail)
  function champ(objet, cle, etiquette, attrs = {}, aide = '', facultatif = '') {
    const ch = champTexte(etiquette, { autocomplete: 'off', ...attrs }, aide, facultatif);
    ch.input.value = objet[cle] || '';
    ch.input.addEventListener('input', () => { objet[cle] = ch.input.value; change(); });
    if (!lisible && objet === v.fiche) ch.input.disabled = true;
    entrees[cle] = ch.input;
    return ch;
  }

  // ── Le résumé en haut : statut, forfait, factures à encaisser, appeler / écrire ──
  const resume = el('div', { class: 'fiche__resume', 'aria-live': 'polite' });
  function dessinerResume() {
    const f = ficheDe(c), ab = abonnementDe(f), dues = aEncaisser(f);
    const statut = v.fiche.statut;
    const depuis = depart.fiche.depuis || (statut === 'en_service' && ab ? ab.debut : '');
    const quand = statut === 'en_service' && depuis ? `depuis le ${leJour(depuis, { long: true })}` : '';
    const contacts = [
      lienTel(depart.fiche.telephone) ? el('a', { class: 'puce', href: lienTel(depart.fiche.telephone) }, icone('i-telephone'), 'Appeler') : null,
      lienCourriel(depart.fiche.courriel) ? el('a', { class: 'puce', href: lienCourriel(depart.fiche.courriel) }, icone('i-courriel'), 'Écrire') : null,
      urlSure(depart.fiche.site) ? el('a', { class: 'puce', href: urlSure(depart.fiche.site), target: '_blank', rel: 'noopener noreferrer' }, icone('i-ordinateur'), 'Son site') : null
    ].filter(Boolean);
    vider(resume,
      el('div', { class: 'fiche__statut' }, badgeStatut(statut), el('span', null, [ab ? texteForfait(ab) : 'Pas encore d’abonnement', quand].filter(Boolean).join(' · '))),
      dues.length ? el('ul', { class: 'fiche__alertes', 'aria-label': 'À encaisser' }, dues.map(x => el('li', null,
        badgeFacture(x), el('span', null, `Facture ${x.numero} · ${montant(x.reste)}`),
        el('button', { class: 'lien lien--petit', type: 'button', onclick: () => preparerRappel(x.abonnement, x.numero) }, 'Préparer le rappel')))) : null,
      contacts.length ? el('div', { class: 'actions' }, contacts) : null);
  }

  // ── Les parties ──
  const sections = {};
  const partie = (cle, titre, ...contenu) => {
    sections[cle] = el('section', { class: 'bloc fiche__partie', id: `fiche-${cle}`, 'aria-labelledby': `fiche-t-${cle}`, tabindex: '-1' },
      el('h3', { id: `fiche-t-${cle}`, class: 'fiche__titre' }, titre), ...contenu);
    return sections[cle];
  };

  // Coordonnées
  const nom = champ(v.portail, 'project_name', 'Nom du client', { maxlength: 100, placeholder: 'Ex. : Plomberie Côté' });
  const contact = champ(v.fiche, 'contact', 'Personne-contact', { maxlength: 80, placeholder: 'Ex. : Marc Côté', autocomplete: 'off' });
  const metier = champ(v.fiche, 'metier', 'Métier', { maxlength: 60, placeholder: 'Ex. : Plombier' });
  const courriel = champ(v.fiche, 'courriel', 'Courriel', { type: 'email', inputmode: 'email', maxlength: 120, spellcheck: 'false', autocapitalize: 'none', placeholder: 'Ex. : marc@plomberiecote.ca' },
    'Les rappels et les rapports partent seulement à cette adresse.');
  const telephone = champ(v.fiche, 'telephone', 'Téléphone', { type: 'tel', inputmode: 'tel', maxlength: 40, placeholder: 'Ex. : 819 555-0142' });
  const site = champ(v.fiche, 'site', 'Site web', { type: 'url', inputmode: 'url', maxlength: 200, spellcheck: 'false', autocapitalize: 'none', placeholder: 'Ex. : plomberiecote.ca' }, '', 'facultatif');
  const adresse = champ(v.fiche, 'adresse', 'Adresse', { maxlength: 160, placeholder: 'Ex. : 12, rue des Érables' }, '', 'facultatif');
  const langue = pilules('Langue de ses courriels', [['fr', 'Français'], ['en', 'English']], v.fiche.langue, x => { v.fiche.langue = x; change(); },
    { aide: 'Le rappel de paiement et le rapport par courriel partent dans cette langue.', petit: true });
  if (!lisible) langue.boite.disabled = true;
  partie('coordonnees', 'Coordonnées', nom.boite, el('div', { class: 'deux' }, contact.boite, metier.boite),
    el('div', { class: 'deux' }, courriel.boite, telephone.boite), el('div', { class: 'deux' }, site.boite, adresse.boite), langue.boite,
    f0.depuis_prospect ? el('p', { class: 'note' }, 'Courriel, téléphone et site repris de sa fiche de prospect : enregistre pour les garder ici.') : null);

  // Service
  const statut = pilules('Où en est le client', Object.entries(STATUTS), v.fiche.statut, x => { v.fiche.statut = x; change(); },
    { aide: 'Le client voit où en est son service dans son espace client.' });
  if (!lisible) statut.boite.disabled = true;
  const depuis = champDate('Mise en service', v.fiche.depuis, { aide: 'Le client voit « En service depuis le … ». Vide : le début de son abonnement.', facultatif: 'facultatif' });
  depuis.input.addEventListener('input', () => { v.fiche.depuis = depuis.input.value; change(); });
  if (!lisible) depuis.input.disabled = true;
  entrees.depuis = depuis.input;
  const forfait = el('div', { class: 'fiche__forfait' });
  function dessinerForfait() {
    const ab = abonnementDe(ficheDe(c));
    if (!ab) {
      return vider(forfait, el('div', { class: 'vide vide--action' },
        el('p', null, el('b', null, 'Pas encore d’abonnement.'), ' Ajoute-le dans l’Argent : ses factures, le crédit des frais de départ et la garantie se calculent tout seuls.'),
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => versArgent('', { client: id, nom: v.portail.project_name.trim() }) }, 'Ajouter son abonnement')));
    }
    vider(forfait, el('div', { class: 'fiche__ligne' },
      el('span', null, el('b', null, ab.forfait_nom), el('span', null, [`${montant(ab.total_mensuel)} par mois`, ab.minutes_incluses ? `${ab.minutes_incluses} min incluses` : '',
        `depuis le ${leJour(ab.debut, { long: true })}`, ab.fin ? `jusqu’au ${leJour(ab.fin, { long: true })}` : ''].filter(Boolean).join(' · '))),
      el('button', { class: 'lien lien--petit', type: 'button', onclick: () => versArgent(ab.id) }, 'Voir dans l’Argent')));
  }
  partie('service', 'Service', statut.boite, depuis.boite, el('div', { class: 'champ' }, el('span', { class: 'champ__titre' }, 'Forfait'), forfait));

  // Factures, et le rappel prêt à envoyer
  const factures = el('div', { class: 'bloc' });
  const rappels = {};             // « ab:numéro » → l'éditeur du rappel
  partie('factures', 'Factures', factures);
  function dessinerFactures() {
    const f = ficheDe(c), ab = abonnementDe(f);
    sections.factures.hidden = !ab;
    if (!ab) return vider(factures);
    const liste = ab.factures || [];
    if (!liste.length) return vider(factures, el('p', { class: 'vide' }, `La 1re facture arrive le ${leJour(ab.debut, { long: true })}.`));
    vider(factures, el('ul', { class: 'factures' }, liste.map(x => {
      const k = `${ab.id}:${x.numero}`;
      const envoyes = (f.courriels || []).filter(m => m.cle === `rappel:${ab.id}:${x.numero}` && m.resultat === 'envoye');
      const aRelancer = (x.etat === 'due' || x.etat === 'en_retard') && x.reste > 0;
      return el('li', { class: `facture facture--${x.etat}`, 'data-facture': k },
        el('div', { class: 'facture__haut' }, el('b', null, `Facture ${x.numero}`), el('span', { class: 'facture__date' }, leJour(x.echeance)), badgeFacture(x),
          el('span', { class: 'montant' }, montant(x.du))),
        x.paye > 0 && x.reste > 0 ? el('p', { class: 'note' }, `${montant(x.paye)} déjà reçus : il reste ${montant(x.reste)}.`) : null,
        envoyes.length ? el('p', { class: 'note' }, `Rappel envoyé ${envoyes.map(m => `le ${moment(m.quand)}${m.qui ? ` par ${m.qui}` : ''}`).join(', ')}.`) : null,
        rappels[k] ? editeurRappel(ab, x) : aRelancer ? el('div', { class: 'actions' },
          el('button', { class: 'btn btn--contour btn--petit', type: 'button', 'data-focus': `rappel-${k}`, onclick: () => preparerRappel(ab.id, x.numero) },
            icone('i-courriel'), envoyes.length ? 'Préparer un autre rappel' : 'Préparer le rappel')) : null);
    })), el('p', { class: 'note' }, 'Un paiement reçu se note dans l’Argent (Marquer payée).'));
  }

  async function preparerRappel(abId, numero) {
    const k = `${abId}:${numero}`;
    aller('factures');
    if (!rappels[k]) {
      rappels[k] = { lecture: true, cle: nouvelleCle('co'), modele: null, sujet: '', texte: '', erreur: '', erreurEnvoi: '', recent: '' };
      dessinerFactures();
      try {
        const d = await api('/portal/admin/fiche/rappel', { methode: 'POST', corps: { client: id, abonnement: abId, facture: numero }, delai: 60000 });
        Object.assign(rappels[k], { modele: d, sujet: d.sujet, texte: d.texte });
      } catch (e) {
        if (e.statut === 401) return;
        rappels[k].erreur = e.message;
      }
      if (!rappels[k]) return;
      rappels[k].lecture = false;
      dessinerFactures();
    }
    const zone = $(`#panneau-corps [data-facture="${CSS.escape(k)}"] .rappel textarea`);
    if (zone) zone.focus({ preventScroll: true });
    const li = $(`#panneau-corps [data-facture="${CSS.escape(k)}"]`);
    if (li) li.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  etat.preparerRappel = preparerRappel;

  function editeurRappel(ab, x) {
    const k = `${ab.id}:${x.numero}`, R = rappels[k];
    const fermer = () => { delete rappels[k]; dessinerFactures(); const b = $(`[data-focus="${CSS.escape(`rappel-${k}`)}"]`); if (b) b.focus(); };
    if (R.lecture) return el('div', { class: 'rappel formulaire--encadre' }, el('p', { class: 'note' }, 'Préparation du rappel…'));
    if (R.erreur) {
      return el('div', { class: 'rappel formulaire--encadre' }, el('p', { class: 'erreur' }, fr(R.erreur)),
        el('div', { class: 'formulaire__pied' }, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: fermer }, 'Fermer')));
    }
    const a = depart.fiche.courriel;
    const courrielChange = nettoyer(v).fiche.courriel !== nettoyer(depart).fiche.courriel;
    const sujet = champTexte('Sujet', { maxlength: 150, autocomplete: 'off' });
    sujet.input.value = R.sujet;
    sujet.input.addEventListener('input', () => { R.sujet = sujet.input.value; });
    const texte = champTexte('Message', { multiligne: true, maxlength: 4000, rows: 12, spellcheck: 'true' }, 'Relis-le et change ce que tu veux : il part tel quel, avec le logo de l’agence.');
    texte.input.value = R.texte;
    texte.input.addEventListener('input', () => { R.texte = texte.input.value; });
    const envoyer = el('button', { class: 'btn btn--petit', type: 'button', disabled: !a || courrielChange }, icone('i-courriel'), 'Envoyer le rappel');
    const envoyerEncore = el('button', { class: 'btn btn--petit btn--danger', type: 'button' }, 'Envoyer encore');
    const envoi = async encore => {
      const bouton = encore ? envoyerEncore : envoyer;
      if (!R.sujet.trim() || !R.texte.trim()) { R.erreurEnvoi = 'Le sujet et le message ne peuvent pas être vides.'; dessinerFactures(); return; }
      const liberer = occuper(bouton, 'Envoi…');
      try {
        const r = await api('/portal/admin/fiche/rappel', { methode: 'POST', delai: 60000, corps: {
          client: id, abonnement: ab.id, facture: x.numero, envoyer: true, cle: R.cle, sujet: R.sujet.trim(), texte: R.texte.trim(), ...(encore ? { encore: true } : {}) } });
        garderFiches(r);
        delete rappels[k];
        toast(r.deja ? 'Ce rappel était déjà parti.' : `Rappel envoyé à ${a}.`);
        rafraichir();
      } catch (e) {
        liberer();
        if (e.statut === 401) return;
        if (e.statut === 409 && e.code === 'recent') R.recent = e.message;
        else R.erreurEnvoi = e.message;
        dessinerFactures();
      }
    };
    envoyer.addEventListener('click', () => envoi(false));
    envoyerEncore.addEventListener('click', () => envoi(true));
    const deja = (R.modele && R.modele.deja) || [];
    return el('div', { class: 'rappel formulaire--encadre' },
      el('p', { class: 'rappel__a' }, a ? ['À ', el('b', null, a), ' · copie cachée à la boîte de l’agence · les réponses vont à ', el('b', null, (E.fiches && E.fiches.repondre_a) || 'info@agenceuio.ca')]
        : el('b', { class: 'attention' }, 'Écris son courriel dans Coordonnées, enregistre, puis envoie le rappel.')),
      courrielChange ? el('p', { class: 'note note--fort' }, 'Le rappel part à l’adresse enregistrée : enregistre d’abord la fiche.') : null,
      sujet.boite, texte.boite,
      deja.length ? el('p', { class: 'note' }, dejaEnvoye(deja)) : null,
      R.erreurEnvoi ? el('p', { class: 'erreur', role: 'alert' }, fr(R.erreurEnvoi)) : null,
      R.recent ? el('div', { class: 'confirmer', role: 'group', 'aria-label': 'Envoyer encore ?' },
        el('span', { class: 'confirmer__question' }, fr(R.recent)),
        el('span', { class: 'confirmer__boutons' }, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { R.recent = ''; dessinerFactures(); } }, 'Non'), envoyerEncore))
        : el('div', { class: 'formulaire__pied' }, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: fermer }, 'Annuler'), envoyer));
  }

  // Rapport du mois : ce qu'il voit (avis, mot), et le courriel du rapport
  const auto = bascule('L’envoyer tout seul chaque mois', '', v.fiche.rapport_auto, x => { v.fiche.rapport_auto = x; change(); });
  if (!lisible) auto.input.disabled = true;
  const autoAide = el('p', { class: 'champ__aide' });
  function dessinerAuto() {
    const detail = auto.boite.querySelector('span span') || el('span');
    const a = nettoyer(v).fiche.courriel;
    const envoi = (E.fiches && E.fiches.envoi_du_mois) || { jour: 2, heure: 10 };
    detail.textContent = fr(`Le ${envoi.jour} du mois vers ${envoi.heure} h, le rapport du mois d’avant part à ${a || 'son courriel'}.`);
    if (!detail.isConnected) auto.boite.querySelector('span').append(detail);
    const enregistre = !!depart.fiche.rapport_auto;
    if (v.fiche.rapport_auto && !a) autoAide.textContent = fr('Écris son courriel dans Coordonnées : sans lui, rien ne part.');
    else if (v.fiche.rapport_auto !== enregistre) autoAide.textContent = fr(v.fiche.rapport_auto ? 'Enregistre pour l’activer.' : 'Enregistre pour l’arrêter.');
    else if (enregistre) {
      const p = prochainEnvoi(ficheDe(c));
      autoAide.textContent = fr(p.quand === 'maintenant' ? `Le rapport ${de(p.mois)} part dans la prochaine demi-heure.`
        : `Le prochain part le ${p.le} vers ${envoi.heure} h (rapport ${de(p.mois)}). Un rapport vide ne part jamais.`);
    } else autoAide.textContent = fr('Sinon, envoie-le d’un clic quand tu veux.');
  }
  const de = cle => { const n = nomMois(cle); return /^[aeiouh]/i.test(n) ? `d’${n}` : `de ${n}`; };
  const RC = { ouvert: false, lecture: false, apercu: null, erreur: '', erreurEnvoi: '', recent: '', cle: '' };
  const courrielRapport = el('div', { class: 'courriel-rapport' });
  async function voirCourrielRapport() {
    Object.assign(RC, { ouvert: true, lecture: true, apercu: null, erreur: '', erreurEnvoi: '', recent: '', cle: nouvelleCle('co') });
    dessinerCourrielRapport();
    try { RC.apercu = await api('/portal/admin/fiche/rapport', { methode: 'POST', corps: { client: id }, delai: 60000 }); }
    catch (e) { if (e.statut === 401) return; RC.erreur = e.message; }
    RC.lecture = false;
    dessinerCourrielRapport();
    const t = $('#panneau-corps .courriel-apercu');
    if (t) t.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function dessinerCourrielRapport() {
    const passe = moisAvant(moisDe(new Date()));
    if (!RC.ouvert) {
      return vider(courrielRapport, el('div', { class: 'actions' },
        el('button', { class: 'btn btn--contour btn--petit', type: 'button', 'data-focus': 'voir-rapport', onclick: voirCourrielRapport }, icone('i-oeil'), `Voir le courriel ${de(passe)}`)));
    }
    const fermer = () => { RC.ouvert = false; dessinerCourrielRapport(); const b = $('[data-focus="voir-rapport"]'); if (b) b.focus(); };
    if (RC.lecture) return vider(courrielRapport, el('p', { class: 'note' }, 'Préparation du courriel… (le serveur compte les appels du mois)'));
    if (RC.erreur) {
      return vider(courrielRapport, el('div', { class: 'vide' }, fr(RC.erreur), ' ',
        el('button', { class: 'lien lien--petit', type: 'button', onclick: fermer }, 'Fermer')));
    }
    const p = RC.apercu, a = depart.fiche.courriel;
    const courrielChange = nettoyer(v).fiche.courriel !== nettoyer(depart).fiche.courriel;
    const envoyer = el('button', { class: 'btn btn--petit', type: 'button', disabled: !a || courrielChange }, icone('i-courriel'), 'Envoyer maintenant');
    const envoyerEncore = el('button', { class: 'btn btn--petit btn--danger', type: 'button' }, 'Envoyer encore');
    const envoi = async encore => {
      const liberer = occuper(encore ? envoyerEncore : envoyer, 'Envoi…');
      try {
        const r = await api('/portal/admin/fiche/rapport', { methode: 'POST', delai: 60000, corps: { client: id, mois: p.mois, envoyer: true, cle: RC.cle, ...(encore ? { encore: true } : {}) } });
        garderFiches(r);
        RC.ouvert = false;
        toast(r.deja ? 'Ce rapport était déjà parti.' : `Rapport envoyé à ${a}.`);
        rafraichir();
      } catch (e) {
        liberer();
        if (e.statut === 401) return;
        if (e.statut === 409 && e.code === 'recent') RC.recent = e.message; else RC.erreurEnvoi = e.message;
        dessinerCourrielRapport();
      }
    };
    envoyer.addEventListener('click', () => envoi(false));
    envoyerEncore.addEventListener('click', () => envoi(true));
    vider(courrielRapport,
      el('div', { class: 'courriel-apercu', role: 'group', 'aria-label': 'Aperçu du courriel' },
        el('p', { class: 'courriel-apercu__tete' }, el('span', null, 'À ', el('b', null, a || 'son courriel')), el('span', null, 'Sujet : ', el('b', null, p.sujet))),
        el('div', { class: 'courriel-apercu__corps' },
          el('p', { class: 'courriel-apercu__titre' }, p.titre_mois ? majuscule(p.titre_mois) : ''),
          (p.lignes || []).length ? el('ul', { class: 'courriel-apercu__chiffres' }, p.lignes.map(l => el('li', null, el('b', null, l.chiffre), el('span', null, l.texte)))) : null,
          p.comparaison ? el('p', null, p.comparaison) : null,
          p.mot ? el('blockquote', null, p.mot) : null,
          el('p', { class: 'note' }, 'Plus un bouton « Voir le rapport complet » vers son espace client.'))),
      (p.deja || []).length ? el('p', { class: 'note' }, dejaEnvoye(p.deja)) : null,
      !a ? el('p', { class: 'note note--fort' }, 'Écris son courriel dans Coordonnées, enregistre, puis envoie.') : null,
      courrielChange ? el('p', { class: 'note note--fort' }, 'Le rapport part à l’adresse enregistrée : enregistre d’abord la fiche.') : null,
      RC.erreurEnvoi ? el('p', { class: 'erreur', role: 'alert' }, fr(RC.erreurEnvoi)) : null,
      RC.recent ? el('div', { class: 'confirmer', role: 'group', 'aria-label': 'Envoyer encore ?' },
        el('span', { class: 'confirmer__question' }, fr(RC.recent)),
        el('span', { class: 'confirmer__boutons' }, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: () => { RC.recent = ''; dessinerCourrielRapport(); } }, 'Non'), envoyerEncore))
        : el('div', { class: 'formulaire__pied' }, el('button', { class: 'btn btn--discret btn--petit', type: 'button', onclick: fermer }, 'Fermer l’aperçu'), envoyer));
  }
  partie('rapport', 'Rapport du mois', rapport.boite,
    el('div', { class: 'bloc fiche__sous' }, el('h4', null, 'Le rapport par courriel'),
      el('p', null, 'Les chiffres du mois fini, en français ou en anglais selon sa fiche. Un courriel ne part qu’avec ton clic, ou tout seul si tu l’actives.'),
      auto.boite, autoAide, courrielRapport));
  rapport.boite.classList.remove('bloc');
  const titreRapport = rapport.boite.querySelector('h3');
  if (titreRapport) titreRapport.classList.add('sr');

  // Documents (rangés avec ce client : ils restent aussi dans Équipe → Documents)
  const docs = el('div', { class: 'bloc' });
  const D = { ajout: false, confirmer: '' };
  const confirmerDoc = confirmations(D, () => dessinerDocuments());
  function dessinerDocuments() {
    const liste = documentsDe(id);
    const blocs = [liste.length ? el('ul', { class: 'documents' }, liste.map(d => el('li', { class: 'document' },
      el('a', { class: 'document__lien', href: urlSure(d.lien), target: '_blank', rel: 'noopener noreferrer' },
        el('span', { class: 'document__icone', 'aria-hidden': 'true' }, icone('i-document')),
        el('span', { class: 'document__texte' }, el('b', null, d.titre), el('span', null, d.note || hote(d.lien)))),
      confirmerDoc(`doc:${d.id}`, 'Retirer', `Retirer « ${d.titre} » ?`, async () => {
        const r = await api('/portal/admin/equipe/document', { methode: 'POST', corps: { id: d.id, retirer: true } });
        garderDocuments(r);
        toast('Document retiré.');
      }, { classe: 'lien lien--petit' }))))
      : el('p', { class: 'vide' }, 'Aucun document pour ce client. Ajoute le lien de son contrat, de son logo, de ses photos ou de son dossier Drive.')];
    if (D.ajout) {
      const cle = D.cle || (D.cle = nouvelleCle('do'));
      const titre = champTexte('Nom', { maxlength: 100, autocomplete: 'off', placeholder: 'Ex. : Contrat signé' });
      const lien = champTexte('Lien', { type: 'url', inputmode: 'url', maxlength: 500, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', placeholder: 'https://drive.google.com/…' });
      const note = champTexte('Note', { maxlength: 200, autocomplete: 'off', placeholder: 'Ex. : signé le 5 octobre' }, '', 'facultatif');
      blocs.push(formulaireEnLigne({ elements: [titre.boite, lien.boite, note.boite], bouton: 'Ajouter le document',
        annuler: () => { D.ajout = false; D.cle = ''; dessinerDocuments(); },
        envoyer: async () => {
          const t = titre.input.value.trim(), l = lien.input.value.trim();
          if (!t) throw new Invalide('Donne un nom au document.', titre.input);
          if (!/^https:\/\/\S+$/.test(l)) throw new Invalide('Colle le lien du document : il commence par https://', lien.input);
          const r = await api('/portal/admin/equipe/document', { methode: 'POST', corps: { cle, titre: t, lien: l, note: note.input.value.trim(), client: id } });
          D.ajout = false; D.cle = '';
          garderDocuments(r);
          toast('Document ajouté.');
        } }));
      requestAnimationFrame(() => titre.input.focus());
    } else {
      blocs.push(el('div', { class: 'actions' }, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => { D.ajout = true; dessinerDocuments(); } },
        icone('i-plus'), 'Ajouter un document')));
    }
    vider(docs, blocs);
  }
  // La réponse de l'Équipe porte tous les documents : l'onglet Équipe et les fiches suivent
  function garderDocuments(r) {
    if (r && r.equipe) {
      E.equipe = r.equipe; E.equipeErreur = ''; E.equipeLu = Date.now();
      rendreEquipe();
      suivreDocuments(r.equipe);
    }
    dessinerDocuments();
  }
  partie('documents', 'Documents', el('p', null, 'Ses liens : contrat, logo, photos, accès. Ils restent aussi dans Équipe → Documents.'), docs);

  // Notes internes (jamais montrées au client)
  const notes = champ(v.fiche, 'notes_internes', 'Notes internes', { multiligne: true, maxlength: String(NOTES_MAX), rows: 5,
    placeholder: 'Ex. : préfère les textos ; paie par Interac le 15 ; son neveu s’occupe du site.' }, 'Seulement pour l’équipe : le client ne les voit jamais.');
  partie('notes', 'Notes internes', notes.boite);

  // Son espace client (ce qu'il voit)
  const noteClient = champ(v.portail, 'notes', 'Note pour le client', { multiligne: true, maxlength: String(NOTE_CLIENT_MAX), rows: 3,
    placeholder: 'Ex. : votre agent répond maintenant aussi en anglais.' }, 'Le client la voit en haut de son espace client.', 'facultatif');
  const demo = champ(v.portail, 'demo_url', 'Lien de la démo', { type: 'url', inputmode: 'url', placeholder: 'https://…', spellcheck: 'false', autocapitalize: 'none' }, '', 'facultatif');
  const ouvrirDemo = el('a', { class: 'btn btn--contour btn--petit', target: '_blank', rel: 'noopener' }, 'Ouvrir');
  const majDemo = () => { const u = urlSure(v.portail.demo_url.trim()); ouvrirDemo.hidden = !u; if (u) ouvrirDemo.href = u; };
  demo.input.addEventListener('input', majDemo);
  majDemo();
  const ligneDemo = el('div', { class: 'champ__ligne' });     // le champ et « Ouvrir » sur la même ligne
  demo.input.before(ligneDemo);
  ligneDemo.append(demo.input, ouvrirDemo);
  const fonctions = E.fonctionnalites.map(x => bascule(x.label, x.desc, v.portail.features[x.key], ok => { v.portail.features[x.key] = ok; change(); }).boite);
  partie('espace', 'Son espace client', el('p', null, 'Ce que le client voit en se connectant : son service, son forfait, son rapport du mois et cette note.'),
    noteClient.boite, demo.boite, fonctions.length ? el('div', { class: 'bloc' }, el('h4', null, 'Fonctionnalités'), fonctions) : null,
    el('p', null, el('a', { class: 'lien-service', href: ESPACE_CLIENT, target: '_blank', rel: 'noopener' }, 'Ouvrir l’espace client', icone('i-sortie'))),
    blocMotDePasse(c));

  // Courriels envoyés
  const envoyes = el('div', { class: 'bloc' });
  function dessinerCourriels() {
    const liste = ficheDe(c).courriels || [];
    if (!liste.length) return vider(envoyes, el('p', { class: 'vide' }, 'Aucun courriel envoyé à ce client pour l’instant.'));
    vider(envoyes, el('ul', { class: 'liste' }, liste.map(m => {
      const [texte, genre] = RESULTATS[m.resultat] || [m.resultat, 'neutre'];
      return el('li', null,
        el('div', { class: 'ligne' }, el('span', { class: 'ligne__titre' }, m.sujet), badge(texte, genre), el('span', { class: 'ligne__quand' }, moment(m.quand))),
        el('span', { class: 'ligne__meta' }, [SORTES[m.sorte] || m.sorte, m.a ? `à ${m.a}` : '', m.qui ? `par ${m.qui}` : '', m.resultat === 'echec' && m.detail ? m.detail : ''].filter(Boolean).join(' · ')));
    })));
  }
  partie('courriels', 'Courriels envoyés', envoyes);

  // Historique (lu seulement quand on le demande)
  const H = { lu: false, lecture: false, liste: [], erreur: '' };
  const historique = el('div', { class: 'bloc' });
  async function lireHistorique() {
    H.lecture = true; H.erreur = ''; dessinerHistorique();
    try { const d = await api(`/portal/admin/fiche/historique?client=${encodeURIComponent(id)}`, { delai: 45000 }); H.liste = d.historique || []; H.lu = true; }
    catch (e) { if (e.statut === 401) return; H.erreur = e.message; }
    H.lecture = false; dessinerHistorique();
  }
  function dessinerHistorique() {
    if (H.lecture) return vider(historique, el('p', { class: 'note' }, 'Lecture de l’historique…'));
    if (!H.lu) {
      return vider(historique, H.erreur ? el('p', { class: 'erreur' }, fr(H.erreur)) : null,
        el('div', { class: 'actions' }, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: lireHistorique }, icone('i-horloge'), 'Voir l’historique')));
    }
    if (!H.liste.length) return vider(historique, el('p', { class: 'vide' }, 'Rien d’écrit pour ce client pour l’instant.'));
    vider(historique, el('ul', { class: 'liste historique' }, H.liste.map(h => el('li', null,
      el('div', { class: 'ligne' }, el('span', { class: 'ligne__titre' }, h.quoi), h.source === 'prospect' ? badge('Prospect', 'neutre') : null,
        el('span', { class: 'ligne__quand' }, moment(h.quand))),
      el('span', { class: 'ligne__meta' }, [h.detail, h.qui].filter(Boolean).join(' · '))))),
      el('div', { class: 'actions' }, el('button', { class: 'lien lien--petit', type: 'button', onclick: lireHistorique }, 'Relire')));
  }
  partie('historique', 'Historique', el('p', null, 'Ce qui a changé dans sa fiche, son abonnement et ses paiements, les courriels envoyés, et ses contacts quand il était prospect.'), historique);
  dessinerHistorique();

  // La barre des parties (on y saute d'un toucher)
  const ordre = [['coordonnees', 'Coordonnées'], ['service', 'Service'], ['factures', 'Factures'], ['rapport', 'Rapport'], ['documents', 'Documents'],
    ['notes', 'Notes'], ['espace', 'Espace client'], ['courriels', 'Courriels'], ['historique', 'Historique']];
  // La partie qu'on lit est allumée ; un fondu sur un bord dit qu'il y a d'autres parties de ce côté
  const puces = el('div', { class: 'fiche__puces' });
  const barre = el('nav', { class: 'fiche__barre', 'aria-label': 'Parties de la fiche' }, puces);
  const doux = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  let actuelle = '';
  function bords() {
    const plus = puces.scrollWidth - puces.clientWidth;
    puces.classList.toggle('fiche__puces--gauche', puces.scrollLeft > 2);
    puces.classList.toggle('fiche__puces--droite', plus > 2 && puces.scrollLeft < plus - 2);
  }
  puces.addEventListener('scroll', bords, { passive: true });
  function dessinerBarre() {
    vider(puces, ordre.filter(([k]) => !sections[k].hidden).map(([k, t]) => el('button', { class: 'puce', type: 'button', 'data-partie': k,
      'aria-current': k === actuelle ? 'true' : null, onclick: () => aller(k, true) }, t)));
    requestAnimationFrame(bords);
  }
  // La partie en haut de l'écran (ou la dernière, tout en bas) : allumée, et ramenée en vue dans la barre
  function suivreLecture() {
    const corps = $('#panneau-corps');
    if (!corps || E.panneau !== etat) return;
    const ligne = corps.getBoundingClientRect().top + barre.offsetHeight + 48;
    const visibles = ordre.map(([k]) => k).filter(k => !sections[k].hidden);
    let cle = visibles[0] || '';
    for (const k of visibles) if (sections[k].getBoundingClientRect().top <= ligne) cle = k;
    if (corps.scrollTop > 0 && corps.scrollTop + corps.clientHeight >= corps.scrollHeight - 4) cle = visibles[visibles.length - 1] || cle;
    if (cle === actuelle) return;
    actuelle = cle;
    for (const b of puces.children) {
      if (b.dataset.partie !== cle) { b.removeAttribute('aria-current'); continue; }
      b.setAttribute('aria-current', 'true');
      // hors des fondus des bords (56 px) : la puce allumée revient au milieu de la barre
      if (b.offsetLeft - 56 < puces.scrollLeft || b.offsetLeft + b.offsetWidth + 56 > puces.scrollLeft + puces.clientWidth) {
        const max = puces.scrollWidth - puces.clientWidth;
        puces.scrollTo({ left: Math.min(max, Math.max(0, b.offsetLeft - (puces.clientWidth - b.offsetWidth) / 2)), behavior: doux() });
      }
    }
  }
  function aller(cle, focus = false) {
    const s = sections[cle];
    if (!s || s.hidden) return;
    const corps = $('#panneau-corps');
    // le filet du titre passe sous celui de la barre : un seul trait
    const haut = s.getBoundingClientRect().top - corps.getBoundingClientRect().top + corps.scrollTop - barre.offsetHeight + 1;
    corps.scrollTo({ top: Math.max(0, haut), behavior: doux() });
    if (focus) s.focus({ preventScroll: true });
  }
  etat.aller = aller;
  // Occupé : un rappel ou un document qu'on écrit, ou l'aperçu du rapport ouvert (la relecture des 2 min attend)
  etat.occupe = () => Object.keys(rappels).length > 0 || RC.ouvert || D.ajout || !!D.confirmer;

  // ── Enregistrer : la fiche, l'espace client, puis le rapport ──
  function preparer() {
    const p = nettoyer(v), d = nettoyer(depart);
    if (!p.portail.project_name) throw new Invalide('Écris le nom du client.', entrees.project_name);
    const fiche = p.fiche;
    if (fiche.courriel && (fiche.courriel.length > 120 || !COURRIEL_RE.test(fiche.courriel))) throw new Invalide('Le courriel est illisible (ex. : marc@plomberiecote.ca).', entrees.courriel);
    const n = chiffresTel(fiche.telephone).length;
    if (fiche.telephone && (n < 10 || n > 15)) throw new Invalide('Le téléphone est illisible (ex. : 819 555-0142).', entrees.telephone);
    if (fiche.site && !SITE_RE.test(fiche.site)) throw new Invalide('Le site est illisible (ex. : plomberiecote.ca).', entrees.site);
    if (fiche.rapport_auto && !fiche.courriel) throw new Invalide('Le rapport par courriel a besoin de son courriel.', entrees.courriel);
    if (fiche.notes_internes.length > NOTES_MAX) throw new Invalide(`Les notes internes : ${NOTES_MAX} caractères au plus.`, entrees.notes_internes);
    if (p.portail.demo_url && !urlSure(p.portail.demo_url)) throw new Invalide('Le lien de la démo doit commencer par https://', entrees.demo_url);
    const demandes = {};
    const champsFiche = CHAMPS.filter(k => JSON.stringify(fiche[k]) !== JSON.stringify(d.fiche[k]));
    if (champsFiche.length) {
      if (!lisible) throw new Invalide('La fiche n’a pas pu être lue : réessaie dans un instant.');
      demandes.fiche = { client: id, ...Object.fromEntries(champsFiche.map(k => [k, fiche[k]])) };
    }
    const champsPortail = Object.keys(p.portail).filter(k => JSON.stringify(p.portail[k]) !== JSON.stringify(d.portail[k]));
    if (champsPortail.length) demandes.portail = { client_id: id, ...Object.fromEntries(champsPortail.map(k => [k, p.portail[k]])) };
    if (rapport.modifie()) demandes.rapport = rapport.preparer();
    return demandes;
  }
  function montrerErreur(e) {
    erreur.textContent = fr(e.message || 'Ça n’a pas marché. Réessaie.');
    if (e.champ) { e.champ.focus(); e.champ.scrollIntoView({ block: 'center' }); }
    else erreur.scrollIntoView({ block: 'nearest' });
  }
  const marque = el('span', { class: 'modif', hidden: true }, 'Changements non enregistrés');
  const boutonEnregistrer = el('button', { class: 'btn', type: 'button', disabled: true }, 'Enregistrer');
  etat.majPied = () => { const m = etat.modifie(); marque.hidden = !m; if (!etat.envoi) boutonEnregistrer.disabled = !m; };
  async function enregistrer() {
    if (!etat.modifie() || etat.envoi) return;
    erreur.textContent = '';
    rapport.effacerErreur();
    let demandes;
    try { demandes = preparer(); } catch (e) { if (e.champ && rapport.boite.contains(e.champ)) rapport.montrerErreur(e); else montrerErreur(e); return; }
    etat.envoi = true;
    const liberer = occuper(boutonEnregistrer, 'Enregistrement…');
    try {
      if (demandes.fiche) {
        garderFiches(await api('/portal/admin/fiche', { methode: 'POST', corps: demandes.fiche, delai: 60000 }));
        const f = ficheDe(c);                    // le serveur a pu corriger (le site reçoit https://)
        for (const k of CHAMPS) {
          const x = k === 'rapport_auto' ? !!f[k] : String(f[k] ?? '');
          depart.fiche[k] = x; v.fiche[k] = x;
          if (entrees[k] && entrees[k].value !== x && typeof x === 'string') entrees[k].value = x;
        }
      }
      if (demandes.portail) {
        const { client_id: _, ...changes } = demandes.portail;
        await api('/portal/admin/update', { methode: 'POST', corps: demandes.portail, delai: 60000 });
        Object.assign(c, JSON.parse(JSON.stringify(changes)));
        Object.assign(depart.portail, JSON.parse(JSON.stringify(changes)));
        if (changes.project_name) $('#panneau-titre').textContent = changes.project_name;
      }
      if (demandes.rapport) {
        try { await rapport.envoyer(demandes.rapport); }
        catch (e) { if (e.statut !== 401) rapport.montrerErreur(e); throw Object.assign(e, { montre: true }); }
      }
      toast(demandes.portail || demandes.rapport ? 'Enregistré. Le client le voit dès maintenant.' : 'Fiche enregistrée.');
      rendreClients(); rendrePortail();
      rafraichir();
    } catch (e) {
      if (e.statut !== 401 && !e.montre) montrerErreur(e);
    } finally {
      liberer();
      etat.envoi = false;
      etat.majPied();
    }
  }
  etat.enregistrer = enregistrer;
  boutonEnregistrer.addEventListener('click', enregistrer);

  // Relu du serveur (toutes les 2 min, ou après un envoi) : seulement ce qui ne s'écrit pas ici
  function rafraichir() {
    dessinerResume(); dessinerForfait(); dessinerFactures(); dessinerAuto(); dessinerCourrielRapport(); dessinerDocuments(); dessinerCourriels(); dessinerBarre();
  }
  // Relue d'ailleurs (l'Argent, l'Équipe, les 2 min) : pas pendant qu'on écrit un rappel ou un document
  etat.rafraichir = force => { if (force || !etat.occupe()) rafraichir(); };

  const avertissement = lisible ? null : el('div', { class: 'vide' },
    E.fichesErreur === 'pas-encore' ? 'La fiche s’affichera dès que le serveur aura reçu sa mise à jour. L’espace client et le rapport marchent déjà.'
      : `La fiche n’a pas pu être lue${E.fichesErreur ? ` (${E.fichesErreur})` : ''}. Ferme et rouvre dans un instant.`);
  // Une seule boîte (pas la grille du panneau) : la barre des parties peut rester collée en haut
  const corps = [el('div', { class: 'fiche' }, resume, barre, avertissement, sections.coordonnees, sections.service, sections.factures, sections.rapport,
    sections.documents, sections.notes, sections.espace, sections.courriels, sections.historique, erreur)];
  etat.focus = () => null;                 // le titre : pas de clavier qui surgit sur un téléphone
  ouvrirPanneau(etat, c.project_name || c.client_id, `@${c.username} · ID ${c.client_id}`, corps,
    [marque, el('button', { class: 'btn btn--discret', type: 'button', onclick: () => fermerPanneau() }, 'Fermer'), boutonEnregistrer]);
  rafraichir();
  etat.majPied();
  // La barre suit la lecture, seulement tant que cette fiche est ouverte
  const fin = new AbortController();
  etat.fermer = () => fin.abort();
  let image = 0;
  $('#panneau-corps').addEventListener('scroll', () => {
    if (E.panneau !== etat) return fin.abort();
    if (!image) image = requestAnimationFrame(() => { image = 0; suivreLecture(); });
  }, { passive: true, signal: fin.signal });
  window.addEventListener('resize', bords, { passive: true, signal: fin.signal });
  requestAnimationFrame(suivreLecture);
  if (rappel) setTimeout(() => preparerRappel(rappel.abonnement, rappel.facture), 80);
  else if (section) setTimeout(() => aller(section), 80);
}

// Les documents des clients, tirés de l'Équipe (sa réponse les porte tous, sans ceux retirés)
export function suivreDocuments(equipe) {
  if (!equipe || !E.fiches) return;
  E.fiches.documents = (equipe.documents || []).filter(d => d.client)
    .map(d => ({ id: d.id, client: d.client, titre: d.titre, lien: d.lien, note: d.note, cree_le: d.cree_le }));
  rendreClients();
}

// L'Argent, avec son abonnement ouvert (ou un nouveau, déjà relié à ce client)
async function versArgent(abId = '', nouveau = null) {
  fermerPanneau();
  if (E.panneau) return;                   // des changements pas enregistrés : on reste sur la fiche
  montrer('argent');
  if (!E.argent) await chargerArgent();
  if (!E.argent) return;
  if (abId) ouvrirAbonnement(abId);
  else ouvrirAbonnement('', nouveau || {});
}

// Depuis l'Argent : « Rappel » sur une facture due ou en retard
export function ouvrirRappel(clientId, abonnement, facture) {
  const c = E.clients.find(x => String(x.client_id) === String(clientId));
  if (!c) return toast('Ce client n’est plus dans l’espace client.', true);
  ouvrirFiche(c, { rappel: { abonnement, facture } });
}

// Après un changement dans l'Argent (abonnement, paiement) : ses factures dans la fiche suivent
export const relireFiches = () => (E.fiches || E.fichesErreur ? chargerFiches() : Promise.resolve());
