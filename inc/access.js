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
