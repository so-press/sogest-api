/**
 * @namespace Editions
 */
import { db } from '../db.js';

const SORTABLE = new Set(['publication', 'modification', 'numero', 'id']);

/**
 * @api {function} listEditions Liste filtrée et triée des éditions
 * @apiName ListEditions
 * @apiGroup Editions
 *
 * @apiParam {Object} [options] Filtres
 * @apiParam {Number} [options.supportId] Filtre sur l'id du support
 * @apiParam {String} [options.sort=publication] Colonne de tri
 * @apiParam {String} [options.order=desc] Sens du tri (asc|desc)
 * @apiSuccess {Object[]} editions Liste des éditions
 */
export async function listEditions({
  supportId = null,
  sort = 'publication',
  order = 'desc',
} = {}) {
  const query = db('editions').select('*').where('trash', '<>', 1);

  if (supportId !== null) {
    if (isNaN(supportId)) throw new Error('Invalid support ID');
    query.where('support_id', supportId);
  }

  const column = SORTABLE.has(String(sort)) ? sort : 'publication';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return await query.orderBy(column, direction);
}

/**
 * @api {function} getEdition Récupère une édition par son id
 * @apiName GetEdition
 * @apiGroup Editions
 *
 * @apiParam {Number} id Identifiant de l'édition
 * @apiSuccess {Object|null} edition L'édition, ou null si introuvable
 */
export async function getEdition(id) {
  if (isNaN(id)) throw new Error('Invalid edition ID');
  return (await db('editions').where('id', id).first()) ?? null;
}

/**
 * @api {function} resolveSupportId Résout un id ou un slug de support en id numérique
 * @apiName ResolveSupportId
 * @apiGroup Editions
 *
 * @apiParam {String|Number} idOrSlug Identifiant ou slug du support
 * @apiSuccess {Number|null} id Id numérique, ou null si introuvable
 */
export async function resolveSupportId(idOrSlug) {
  if (/^\d+$/.test(String(idOrSlug))) return parseInt(idOrSlug, 10);
  const row = await db('supports').select('id').where('slug', idOrSlug).first();
  return row?.id ?? null;
}
