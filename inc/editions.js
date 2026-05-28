import { db } from '../db.js';

const SORTABLE = new Set(['publication', 'modification', 'numero', 'id']);

/**
 * Liste filtrée et triée des éditions.
 * @param {{supportId?: number, sort?: string, order?: 'asc'|'desc'}} [options]
 * @returns {Promise<Object[]>}
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
 * Récupère une édition par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getEdition(id) {
  if (isNaN(id)) throw new Error('Invalid edition ID');
  return (await db('editions').where('id', id).where('trash', '<>', 1).first()) ?? null;
}

/**
 * Résout un id ou un slug de support en id numérique.
 * @param {string|number} idOrSlug
 * @returns {Promise<number|null>}
 */
export async function resolveSupportId(idOrSlug) {
  if (/^\d+$/.test(String(idOrSlug))) return parseInt(idOrSlug, 10);
  const row = await db('supports').select('id').where('slug', idOrSlug).where('trash', '<>', 1).first();
  return row?.id ?? null;
}
