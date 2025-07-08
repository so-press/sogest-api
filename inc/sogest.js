
/**
 * @namespace Sogest
 */

/**
 * @api {function} sogestUrl Construit une URL complète vers l'API SOGEST
 * @apiName SogestUrl
 * @apiGroup Sogest
 *
 * @apiParam {String} uri URI à ajouter à l'URL de base
 * @apiParam {Object} query Paramètres de requête optionnels
 *
 * @apiSuccess {String} url URL complète construite
 */
export function sogestUrl(uri, query = {}) {
  const base = sogestBaseUrl();
  const path = uri.replace(/^\/+/, '');
  const url = `${base}${path}`;
  const params = new URLSearchParams(query).toString();
  return params ? `${url}?${params}` : url;
}


/**
 * @api {function} sogestBaseUrl Retourne l'URL de base configurée pour SOGEST
 * @apiName SogestBaseUrl
 * @apiGroup Sogest
 *
 * @apiSuccess {String} url URL de base
 */
export function sogestBaseUrl() {
  const base = process.env.SOGEST_URL.replace(/\/+$/, '')+'/';
  return base;
}

