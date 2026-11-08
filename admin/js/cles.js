// Clés d'accès (« passkeys ») : Face ID, Touch ID, l'empreinte ou Windows Hello.
// La clé privée ne quitte jamais l'appareil (ni le trousseau iCloud ou Google) :
// le serveur ne garde que la clé publique. Elle ne marche que sur agenceuio.ca,
// donc une fausse page (hameçonnage) ne peut pas s'en servir.
import { api } from './api.js';

const versOctets = s => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob(s);
  return Uint8Array.from(b, c => c.charCodeAt(0)).buffer;
};
const versTexte = tampon => {
  const o = new Uint8Array(tampon);
  let b = '';
  for (let i = 0; i < o.length; i++) b += String.fromCharCode(o[i]);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const clesPossibles = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get);

export async function biometrieDispo() {
  if (!clesPossibles()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
}
export async function autoRemplissageDispo() {
  try {
    return !!(clesPossibles() && PublicKeyCredential.isConditionalMediationAvailable && await PublicKeyCredential.isConditionalMediationAvailable());
  } catch (e) { return false; }
}

// Un défi neuf du serveur (valable 5 minutes, une seule fois). On le demande AVANT
// le toucher du bouton : Safari exige que Face ID s'ouvre tout de suite après le geste.
export const preparer = mode => api('/portal/admin/cle/options', { methode: 'POST', corps: { mode }, auth: mode === 'inscription' });

export async function signer(prepare, { conditionnel = false, signal } = {}) {
  const o = prepare.options;
  const publicKey = { ...o, challenge: versOctets(o.challenge),
    allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: versOctets(c.id) })) };
  const demande = { publicKey, signal };
  if (conditionnel) demande.mediation = 'conditional';
  const cle = await navigator.credentials.get(demande);
  if (!cle) throw Object.assign(new Error('Aucune clé'), { name: 'NotAllowedError' });
  const r = cle.response;
  return { id: cle.id, rawId: versTexte(cle.rawId), type: cle.type,
    authenticatorAttachment: cle.authenticatorAttachment || undefined,
    clientExtensionResults: cle.getClientExtensionResults ? cle.getClientExtensionResults() : {},
    response: { clientDataJSON: versTexte(r.clientDataJSON), authenticatorData: versTexte(r.authenticatorData),
      signature: versTexte(r.signature), userHandle: r.userHandle ? versTexte(r.userHandle) : undefined } };
}

export async function creer(prepare) {
  const o = prepare.options;
  const publicKey = { ...o, challenge: versOctets(o.challenge), user: { ...o.user, id: versOctets(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: versOctets(c.id) })) };
  const cle = await navigator.credentials.create({ publicKey });
  if (!cle) throw Object.assign(new Error('Aucune clé'), { name: 'NotAllowedError' });
  const r = cle.response;
  return { id: cle.id, rawId: versTexte(cle.rawId), type: cle.type,
    authenticatorAttachment: cle.authenticatorAttachment || undefined,
    clientExtensionResults: cle.getClientExtensionResults ? cle.getClientExtensionResults() : {},
    response: { clientDataJSON: versTexte(r.clientDataJSON), attestationObject: versTexte(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : [] } };
}

// Une erreur du navigateur, en mots simples (null : annulé, rien à dire)
export function messageCle(e, nom) {
  if (!e) return null;
  if (e.name === 'AbortError') return null;
  if (e.name === 'NotAllowedError') return `La demande a été annulée, ou ${nom} n’a pas répondu. Réessaie quand tu veux.`;
  if (e.name === 'InvalidStateError') return 'Cet appareil a déjà une clé d’accès pour ton compte.';
  if (e.name === 'SecurityError') return 'Les clés d’accès ne fonctionnent que sur agenceuio.ca.';
  if (e.name === 'NotSupportedError') return 'Cet appareil ne permet pas les clés d’accès.';
  return e.message || 'La clé d’accès n’a pas fonctionné.';
}
