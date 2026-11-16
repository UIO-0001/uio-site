// L'onglet « Accueil » de la fiche d'un client (2026-11-16) : le formulaire d'accueil que son
// propriétaire remplit avant qu'on écrive le script de son agent répondeur.
//  - Créer le lien (agenceuio.ca/accueil.html#…), le copier ou copier un message prêt à envoyer ;
//    « Nouveau lien » annule l'ancien.
//  - Ses réponses, section par section, et ce qui manque encore.
//  - « Pour le script » : les variables Retell, les règles à mettre dans le script et la section
//    « telephonie » de sa fiche json, à copier.
// Le préremplissage (après la méga analyse) se fait par l'Assistant ou un Claude avec une clé « crm »
// (action « accueil.preremplir ») : rien ne s'écrit ici sans un clic.
import { icone, vider, date, heure, toast, copier, ymd } from './outils.js';
import { api } from './api.js';
import { el, badge } from './formes.js';
import { leJour } from './argent.js';

const GENRES = { '': 'neutre', prerempli: 'neutre', envoye: 'attente', en_cours: 'attente', soumis: '' };
const moment = iso => { const d = date(iso); return d ? `${leJour(ymd(d))} à ${heure(d)}` : ''; };

function valeurLisible(c, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (c.type === 'case') return v ? 'Oui' : null;
  if (c.type === 'choix') { const o = (c.options || []).find(x => x.valeur === v); return o ? o.fr : v; }
  if (c.type === 'liste') {
    return el('ul', { class: 'accueil__lignes' }, v.map(l => el('li', null,
      c.colonnes.map(col => l[col.cle]).filter(Boolean).join(' · '))));
  }
  return el('span', { class: 'accueil__texte' }, String(v));
}

const blocCopie = (titre, texte, aide = '') => el('div', { class: 'bloc fiche__sous' },
  el('h4', null, titre), aide ? el('p', null, aide) : null,
  el('pre', { class: 'accueil__pre' }, texte),
  el('div', { class: 'actions' }, el('button', { class: 'puce', type: 'button', onclick: async () => toast(await copier(texte) ? 'Copié.' : 'Copie impossible : sélectionne le texte.') }, icone('i-copier'), 'Copier')));

export function blocAccueil(c) {
  const id = String(c.client_id);
  const boite = el('div', { class: 'bloc accueil' });
  const S = { lu: false, lecture: false, erreur: '', a: null, sections: [], occupe: false };

  async function lire(frais = false) {
    S.lecture = true; S.erreur = ''; dessiner();
    try {
      const d = await api(`/portal/admin/accueil?client=${encodeURIComponent(id)}${frais ? '&frais=1' : ''}`, { delai: 60000 });
      S.a = d.accueil; S.sections = d.sections || []; S.lu = true;
    } catch (e) { S.erreur = e.statut === 404 ? 'Le serveur n’a pas encore le formulaire d’accueil (sa mise à jour arrive).' : e.message; }
    S.lecture = false; dessiner();
  }

  async function lien(nouveau = false) {
    if (S.occupe) return;
    S.occupe = true; dessiner();
    try {
      const d = await api('/portal/admin/accueil/lien', { methode: 'POST', corps: { client: id, nouveau } });
      S.a = d.accueil;
      toast(nouveau ? 'Nouveau lien créé : l’ancien ne marche plus.' : 'Lien prêt.');
    } catch (e) { toast(e.message, true); }
    S.occupe = false; dessiner();
  }

  const message = a => `Bonjour,\n\nPour que votre agent répondeur réponde exactement comme vous, voici un court formulaire (10 à 15 minutes). `
    + `On a déjà rempli ce qu’on a trouvé : il suffit de vérifier, corriger et compléter. Vos réponses s’enregistrent au fur et à mesure.\n\n${a.lien}\n\n`
    + `Le lien est personnel : ne le partagez pas. Merci !\n\nL’équipe Agence UIO`;

  function dessiner() {
    if (S.lecture && !S.lu) return vider(boite, el('p', { class: 'note' }, 'Lecture du formulaire d’accueil…'));
    if (!S.lu) {
      return vider(boite, S.erreur ? el('p', { class: 'erreur' }, S.erreur) : null,
        el('div', { class: 'actions' }, el('button', { class: 'btn btn--contour btn--petit', type: 'button', onclick: () => lire() }, 'Voir le formulaire d’accueil')));
    }
    const a = S.a, s = a.script || {};
    const etat = el('div', { class: 'accueil__etat' },
      badge(a.etat_texte || 'Pas commencé', GENRES[a.etat] ?? 'neutre'),
      a.soumis_le ? el('span', { class: 'note' }, `Reçu le ${moment(a.soumis_le)}${a.envois > 1 ? ` (${a.envois} envois)` : ''}`) : null,
      a.maj_le ? el('span', { class: 'note' }, `Modifié le ${moment(a.maj_le)} par ${a.maj_par === 'client' ? 'le propriétaire' : a.maj_par}`) : null,
      a.ouvert_le ? el('span', { class: 'note' }, `Ouvert le ${moment(a.ouvert_le)}`) : null,
      el('button', { class: 'puce', type: 'button', onclick: () => lire(true) }, icone('i-actualiser'), 'Relire'));

    const lienBloc = el('div', { class: 'bloc fiche__sous' }, el('h4', null, 'Le lien du propriétaire'),
      a.lien ? el('p', null, el('code', null, a.lien)) : el('p', null, a.lien_expire ? 'Le lien a expiré (90 jours).' : 'Pas encore de lien. Préremplis d’abord ce que la méga analyse a trouvé (demande-le à l’Assistant), puis crée le lien.'),
      a.lien ? el('p', { class: 'note' }, `Valide jusqu’au ${moment(a.expire_le)}. Ne l’ouvre pas toi-même : il serait marqué « ouvert ».`) : null,
      el('div', { class: 'actions' },
        a.lien ? el('button', { class: 'btn btn--petit', type: 'button', onclick: async () => toast(await copier(message(a)) ? 'Message copié.' : 'Copie impossible.') }, 'Copier le message pour le client') : null,
        a.lien ? el('button', { class: 'puce', type: 'button', onclick: async () => toast(await copier(a.lien) ? 'Lien copié.' : 'Copie impossible.') }, 'Copier le lien') : null,
        el('button', { class: a.lien ? 'puce' : 'btn btn--petit', type: 'button', disabled: S.occupe, onclick: () => lien(!!a.lien || a.lien_expire) }, a.lien ? 'Nouveau lien' : 'Créer le lien')));

    const manque = (s.manque || []);
    const manqueBloc = manque.length ? el('div', { class: 'bloc fiche__sous' }, el('h4', null, `Encore à compléter (${manque.length})`),
      el('ul', { class: 'accueil__lignes' }, manque.map(m => el('li', null, m.fr)))) : null;

    const r = a.reponses || {};
    const reponses = el('div', { class: 'bloc fiche__sous' }, el('h4', null, 'Ses réponses'),
      Object.keys(r).length ? S.sections.map(sec => {
        const lignes = sec.champs.map(ch => [ch, valeurLisible(ch, r[ch.cle])]).filter(([, v]) => v);
        return lignes.length ? el('details', { class: 'accueil__section' }, el('summary', null, `${sec.fr} (${lignes.length})`),
          el('dl', { class: 'accueil__dl' }, lignes.map(([ch, v]) => el('div', null, el('dt', null, ch.fr), el('dd', null, v))))) : null;
      }) : el('p', { class: 'vide' }, 'Aucune réponse pour l’instant.'));

    const v = s.variables || {};
    const variables = Object.entries(v).map(([k, x]) => `${k} = ${x || '(vide)'}`).join('\n');
    const regles = (s.regles || []).map(x => `- ${x}`).join('\n');
    const faq = (s.faq || []).map(f => `- ${f.q} → ${f.r || ''}`).join('\n');
    const script = Object.keys(r).length ? el('div', { class: 'bloc' }, el('h3', { class: 'fiche__titre' }, 'Pour le script'),
      el('p', null, 'Tiré de ses réponses : à coller dans les variables de son agent Retell, dans son script et dans clients/<id>.json. Relis avant : rien ne vaut sans les appels d’essai.'),
      blocCopie('Variables Retell', variables),
      regles ? blocCopie('Règles du script', regles, 'Elles corrigent les fautes de la répétition Mobilo : pas de prix avant le service, seulement les villes de la liste, les cas spéciaux sur soumission.') : null,
      faq ? blocCopie('Questions fréquentes', faq) : null,
      blocCopie('Section « telephonie » de la fiche', JSON.stringify(s.telephonie || {}, null, 2), 'garde, transfert_urgence, cellulaires, lien d’avis… Vérifie chaque numéro.'),
      (s.rendez_vous || {}).mode ? blocCopie('Rendez-vous', JSON.stringify(s.rendez_vous, null, 2)) : null) : null;

    vider(boite, el('h3', { class: 'fiche__titre' }, 'Formulaire d’accueil'),
      el('p', null, 'Ce que le propriétaire veut que son agent dise : services et prix, territoire, urgences, rendez-vous, ton. On l’envoie avant d’écrire son script.'),
      etat, S.erreur ? el('p', { class: 'erreur' }, S.erreur) : null, lienBloc, manqueBloc, reponses, script);
  }

  dessiner();
  return { boite, ouvrir: () => { if (!S.lu && !S.lecture) lire(); } };
}
