import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./config/config.json'));
const tokenScopes = config.tokenScopes || {};

/**
 * Détermine si la requête a un accès « complet » (toutes les ressources),
 * par opposition à un accès restreint au périmètre de l'utilisateur.
 *
 * Accès complet si :
 * - authentification par token statique (accès machine de confiance), ou
 * - JWT dont l'utilisateur est admin : `level === 'admin'` ou flag `ultra_admin`.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isAdminRequest(req) {
  if (req.isJwt === false) return true; // token statique
  const u = req.user;
  return !!u && (u.level === 'admin' || !!u.ultra_admin);
}

/**
 * Détermine si la requête a un accès « ultra admin » (administration
 * transverse : historique global, etc.), par opposition à `isAdminRequest`
 * qui couvre tous les admins.
 *
 * Accès accordé si :
 * - authentification par token statique (accès machine de confiance), ou
 * - JWT dont l'utilisateur est ultra admin : `level === 'admin'` **et** colonne
 *   `users.ultra_admin` renseignée (même définition que `can.ultraAdmin` dans
 *   `getUserCapabilities`, cf. `inc/rh/users.js`).
 *
 * Note : `req.user` est la ligne `users` rechargée par `authMiddleware`, pas le
 * payload du JWT — on lit donc la colonne `ultra_admin`, pas `can.ultraAdmin`.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isUltraAdminRequest(req) {
  if (req.isJwt === false) return true; // token statique
  const u = req.user;
  if (!u || u.level !== 'admin') return false;
  const v = u.ultra_admin;
  return v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0;
}

/**
 * Périmètre d'écriture d'un jeton applicatif statique sur les équipes.
 *
 * Par défaut un jeton statique peut écrire partout (comportement historique).
 * `config/config.json` peut le restreindre à une liste d'équipes :
 *
 * ```json
 * "tokenScopes": { "suivi-ca-regie": { "equipes": [4019, 4172] } }
 * ```
 *
 * La clé est le **nom** du jeton dans `tokens`. Un jeton absent de
 * `tokenScopes` reste non restreint.
 *
 * @param {import('express').Request} req
 * @param {number} equipeId
 * @returns {boolean}
 */
export function isEquipeInTokenScope(req, equipeId) {
  if (req.isJwt !== false) return true; // pas un jeton statique : hors sujet
  const scope = tokenScopes[req.tokenName];
  if (!scope || !Array.isArray(scope.equipes)) return true;
  return scope.equipes.map(Number).includes(Number(equipeId));
}
