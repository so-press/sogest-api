import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

export function setRequestContext(req, res, next) {
  requestContext.run({ req }, () => {
    next();
  });
}

export function getRequest() {
  const store = requestContext.getStore();
  return store?.req;
}

/**
 * Base publique de l'API : `BASE_URL` si défini, sinon déduite de la requête en
 * cours (en honorant `X-Forwarded-Proto` derrière un reverse proxy). Chaîne vide
 * en dernier recours : les URLs produites sont alors relatives, ce qui reste
 * exploitable par un client qui a déjà l'API pour base.
 * @returns {string}
 */
export function apiBaseUrl() {
  const configured = (process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const req = getRequest();
  if (!req) return '';

  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwarded || req.protocol}://${req.get('host')}`;
}
