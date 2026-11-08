// Trusted Types : la page refuse tout HTML ou script fabriqué à partir de texte
// (règle CSP « require-trusted-types-for 'script' »). Deux exceptions, ici seulement :
// lire la page d'accueil du site (document inerte, jamais affiché) et le service worker.
let politique = null;
try {
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    politique = window.trustedTypes.createPolicy('uio', {
      createHTML: texte => texte,
      createScriptURL: adresse => {
        const u = new URL(adresse, location.href);
        if (u.origin === location.origin && /\/sw\.js$/.test(u.pathname)) return u.href;
        throw new TypeError('Adresse de script refusée');
      }
    });
  }
} catch (e) { /* politique déjà créée ou navigateur sans Trusted Types */ }

export const htmlInerte = texte => (politique ? politique.createHTML(texte) : texte);
export const adresseScript = adresse => (politique ? politique.createScriptURL(adresse) : adresse);
