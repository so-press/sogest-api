/**
 * Règles d'origine CORS, partagées par `ALLOWED_DOMAINS` (.env) et les domaines
 * des clients de l'API (table `api_clients_domaines`).
 *
 * Une entrée est un host sans schéma :
 * - `host`      → ce host, n'importe quel port ;
 * - `host:port` → ce host sur ce port exactement ;
 * - `*.domaine` → tout sous-domaine de `domaine`, et l'apex.
 */

export const DOMAINE_REGEX = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** Normalise une saisie (`https://Foo.com/` → `foo.com`), ou `null` si invalide. */
export function normaliserDomaine(raw) {
  let d = String(raw ?? '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  return DOMAINE_REGEX.test(d) ? d : null;
}

/**
 * Compile une liste d'entrées en fonction `(origin) => boolean`.
 * @param {string[]} entries
 */
export function compilerDomaines(entries) {
  const exact = new Set();
  const hostOnly = new Set();
  const wildcard = [];

  for (const raw of entries) {
    const entry = String(raw).trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith('*.')) wildcard.push(entry.slice(2));
    else if (entry.includes(':')) exact.add(entry);
    else hostOnly.add(entry);
  }

  return (origin) => {
    try {
      const { hostname, port } = new URL(origin);
      const key = port ? `${hostname}:${port}` : `${hostname}:443`;
      return exact.has(key)
        || hostOnly.has(hostname)
        || wildcard.some((base) => hostname === base || hostname.endsWith(`.${base}`));
    } catch {
      return false;
    }
  };
}

/** Entrées de `ALLOWED_DOMAINS` (fonction : `.env` n'est pas forcément chargé à l'import). */
export function domainesEnv() {
  return (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
