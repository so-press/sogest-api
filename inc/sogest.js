
/**
 * @namespace Sogest
 */

/**
 * Construit une URL complète vers l'API SOGEST avec gestion du slash et des paramètres
 * @param {string} uri - URI à ajouter à l'URL de base
 * @param {Object} query - Paramètres de requête optionnels
 * @returns {string} URL complète construite
 */
export function sogestUrl(uri, query = {}) {
  const base = sogestBaseUrl();
  const path = uri.replace(/^\/+/, '');
  const url = `${base}${path}`;
  const params = new URLSearchParams(query).toString();
  return params ? `${url}?${params}` : url;
}


export function sogestBaseUrl() {
  const base = process.env.SOGEST_URL.replace(/\/+$/, '')+'/';
  return base;
}

