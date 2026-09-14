/**
 * Client de l'API « ask » (https://tools.sopress.dev/ask/), le service maison
 * qui pose une question à un modèle, éventuellement en lui faisant lire une
 * image. Port de `askGPT()` (sogest, include/auto/chatgpt.inc.php).
 *
 * Deux conventions du service sont reprises telles quelles :
 * - les deux consignes ajoutées à chaque prompt (réponse nue, préfixe
 *   « ERREUR: » en cas d'impossibilité) ;
 * - une réponse commençant par « ERREUR: » vaut absence de réponse.
 *
 * Aucune exception n'est levée : un service indisponible, un délai dépassé ou
 * un refus du modèle rendent une chaîne vide. C'est un enrichissement, jamais
 * une dépendance dont l'échec doit faire échouer l'appelant.
 */

const ASK_URL = process.env.ASK_URL || 'https://tools.sopress.dev/ask/';

const CONSIGNES = [
  'Ta réponse sera uniquement composée de la réponse à la question du prompt, sans introduction ni commentaire de ta part.',
  "En cas d'erreur ou d'impossibilité de répondre à la demande, commence ta réponse par le mot \"ERREUR:\" suivi d'un message d'erreur expliquant le probleme rencontré.",
].join('\n');

/** Vrai si la réponse du modèle est un refus explicite (« ERREUR: … »). */
function estErreur(message) {
  return String(message || '').trim().slice(0, 7).toUpperCase().startsWith('ERREUR:');
}

/**
 * Pose une question au modèle.
 *
 * @param {string} prompt
 * @param {{image?: string, temperature?: number, tokens?: number, timeout?: number}} [options]
 *   `image` est une URL publique : c'est le service qui va la chercher.
 * @returns {Promise<string>} La réponse, ou `''` (service KO, délai dépassé,
 *   refus du modèle).
 */
export async function ask(prompt, { image, temperature = 0, tokens, timeout = 30000 } = {}) {
  const body = new URLSearchParams({
    w: `${prompt}\n${CONSIGNES}`,
    temperature: String(temperature),
  });
  if (image) body.set('image', image);
  if (tokens) body.set('tokens', String(tokens));

  let message;
  try {
    const res = await fetch(ASK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Client': 'sogest-api',
      },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return '';
    ({ message } = await res.json());
  } catch (err) {
    console.error(`ask: ${err}`);
    return '';
  }

  if (!message || estErreur(message)) return '';
  return String(message).trim();
}

/**
 * Pose une question dont la réponse attendue est un objet JSON.
 *
 * Le modèle encadre volontiers son JSON de texte ou d'un bloc ```json : on ne
 * retient que ce qui va de la première accolade à la dernière.
 *
 * @param {string} prompt
 * @param {Object} [options] Mêmes options que `ask()`
 * @returns {Promise<Object|null>} L'objet, ou `null` si rien d'exploitable
 */
export async function askJson(prompt, options = {}) {
  const reponse = await ask(prompt, options);
  if (!reponse) return null;

  const accolades = reponse.match(/\{[\s\S]*\}/);
  if (!accolades) return null;

  try {
    const objet = JSON.parse(accolades[0]);
    return objet && typeof objet === 'object' ? objet : null;
  } catch {
    return null;
  }
}
