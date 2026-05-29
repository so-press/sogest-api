/**
 * Construit une URL complète vers SOGEST à partir d'une URI et de paramètres.
 * @param {string} uri
 * @param {Object} [query]
 * @returns {string}
 */
export function sogestUrl(uri, query = {}) {
  const base = sogestBaseUrl();
  const path = uri.replace(/^\/+/, '');
  const url = `${base}${path}`;
  const params = new URLSearchParams(query).toString();
  return params ? `${url}?${params}` : url;
}


/**
 * URL de base configurée pour SOGEST (slash final garanti).
 * @returns {string}
 */
export function sogestBaseUrl() {
  const base = process.env.SOGEST_URL.replace(/\/+$/, '')+'/';
  return base;
}
