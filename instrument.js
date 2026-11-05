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
 * Signale une erreur attrapée par l'application (et donc invisible du
 * gestionnaire d'erreurs d'Express). Sans effet si GlitchTip n'est pas
 * configuré.
 * @param {unknown} err
 * @param {import('express').Request} [req]
 */
export function signalerErreur(err, req) {
  if (!glitchtipActif) return;
  Sentry.withScope((scope) => {
    if (req?.user?.id) scope.setUser({ id: String(req.user.id) });
    if (req) scope.setTag('jeton', req.isJwt ? 'jwt' : 'statique');
    Sentry.captureException(err);
  });
}

export { Sentry };
