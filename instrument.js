// Remontée des erreurs vers GlitchTip (https://errors.sopress.dev), via le SDK
// Sentry dont GlitchTip parle le protocole.
//
// Importé en TOUT PREMIER par server.js : le SDK doit être initialisé avant que
// le reste de l'application ne se charge. Sans `GLITCHTIP_DSN`, rien n'est
// initialisé et l'API tourne exactement comme avant.
import 'dotenv/config';
import * as Sentry from '@sentry/node';

const dsn = (process.env.GLITCHTIP_DSN || '').trim();

export const glitchtipActif = Boolean(dsn);

if (glitchtipActif) {
  Sentry.init({
    dsn,
    environment: (process.env.GLITCHTIP_ENV || 'prod').trim(),
    // Erreurs seulement : GlitchTip n'a pas l'usage des traces de performance.
    tracesSampleRate: 0,
    // Ni corps de requête, ni cookies, ni en-têtes d'authentification.
    sendDefaultPii: false,
  });
  console.log('🪲 GlitchTip actif');
}

/**
 * L'utilisateur JWT de la requête, tel que GlitchTip l'affiche : id, email,
 * nom et niveau. `null` sous jeton applicatif statique.
 * @param {import('express').Request} [req]
 */
function utilisateur(req) {
  const u = req?.user;
  if (!u?.id) return null;
  return {
    id: String(u.id),
    email: u.email || undefined,
    username: u.nomComplet || [u.prenom, u.nom].filter(Boolean).join(' ') || undefined,
    level: u.level || undefined,
  };
}

/**
 * Middleware, monté après l'authentification : rattache l'utilisateur à toutes
 * les erreurs de la requête, y compris celles qui échappent à handleResponse.
 */
export function glitchtipUtilisateur(req, res, next) {
  if (glitchtipActif) {
    const u = utilisateur(req);
    if (u) Sentry.setUser(u);
  }
  next();
}

/**
 * Signale une erreur attrapée par l'application (et donc invisible du
 * gestionnaire d'erreurs d'Express). Sans effet si GlitchTip n'est pas
 * configuré.
 * @param {unknown} err
 * @param {import('express').Request} [req]
 */
export function signalerErreur(err, req) {
  if (!glitchtipActif) return;
  Sentry.withScope((scope) => {
    const u = utilisateur(req);
    if (u) scope.setUser(u);
    if (req) scope.setTag('jeton', req.isJwt ? 'jwt' : 'statique');
    Sentry.captureException(err);
  });
}

export { Sentry };
