import dayjs from 'dayjs';
import { db } from '../db.js';

// Colonnes autorisées pour le tri (évite toute injection via ?sort=)
const SORTABLE = new Set(['date', 'valeur', 'type', 'creation', 'id']);
// Champs modifiables d'une absence (le rattachement user_id n'est pas modifiable)
const EDITABLE = ['date', 'type', 'valeur'];

/**
 * Liste filtrée et triée des absences.
 * @param {{userId?: number, type?: string, dateFrom?: string, dateTo?: string, year?: number, month?: number, sort?: string, order?: 'asc'|'desc'}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listAbsences({
  userId = null,
  type = null,
  dateFrom = null,
  dateTo = null,
  year = null,
  month = null,
  sort = 'date',
  order = 'desc',
} = {}) {
  const query = db('absences').select('*');

  if (userId !== null) {
    if (isNaN(userId)) throw new Error('Invalid user ID');
    query.where('user_id', userId);
  }

  if (type) query.where('type', type);
  if (dateFrom) query.where('date', '>=', dateFrom);
  if (dateTo) query.where('date', '<=', dateTo);

  if (year !== null) {
    if (isNaN(year)) throw new Error('Invalid year');
    query.whereRaw('YEAR(date) = ?', [year]);
  }

  if (month !== null) {
    if (isNaN(month) || month < 1 || month > 12) throw new Error('Invalid month');
    // Un mois s'entend toujours dans une année précise
    if (year === null) throw new Error('Year is required when filtering by month');
    query.whereRaw('MONTH(date) = ?', [month]);
  }

  const column = SORTABLE.has(String(sort)) ? sort : 'date';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return await query.orderBy(column, direction);
}

/**
 * Récupère une absence par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getAbsence(id) {
  if (isNaN(id)) throw new Error('Invalid absence ID');
  return (await db('absences').where('id', id).first()) ?? null;
}

/**
 * Recherche une absence pour un utilisateur à une date donnée.
 * @param {number} userId
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<Object|null>}
 */
export async function findAbsence(userId, date) {
  return (await db('absences').where({ user_id: userId, date }).first()) ?? null;
}

/**
 * Crée une absence.
 * @param {{user_id: number, date: string, type?: string, valeur?: number}} data
 * @returns {Promise<Object>}
 */
export async function createAbsence({ user_id, date, type = 'conge', valeur = 1 }) {
  if (!user_id || isNaN(user_id)) throw new Error('Invalid user ID');
  if (!date) throw new Error('Date is required');

  const [id] = await db('absences').insert({
    user_id,
    date,
    type,
    valeur,
    creation: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  });

  return await getAbsence(id);
}

/**
 * Met à jour une absence. Seuls les champs `date`, `type` et `valeur` sont modifiables.
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<boolean>} true si une ligne a été modifiée
 */
export async function updateAbsence(id, data) {
  if (isNaN(id)) throw new Error('Invalid absence ID');
  if (!data) return false;

  const update = {};
  for (const field of EDITABLE) {
    if (data[field] !== undefined) update[field] = data[field];
  }
  if (Object.keys(update).length === 0) return false;

  const count = await db('absences').where('id', id).update(update);
  return count > 0;
}

/**
 * Supprime une absence.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteAbsence(id) {
  if (isNaN(id)) throw new Error('Invalid absence ID');
  const count = await db('absences').where('id', id).del();
  return count > 0;
}

/**
 * Récapitulatif des absences d'un utilisateur sur une période (totaux par type).
 * @param {{userId: number, dateFrom?: string, dateTo?: string}} options
 * @returns {Promise<{byType: Object<string, {jours: number, count: number}>, total: number, count: number}>}
 */
export async function recapAbsences({ userId, dateFrom = null, dateTo = null }) {
  if (isNaN(userId)) throw new Error('Invalid user ID');

  const query = db('absences')
    .select('type')
    .sum({ jours: 'valeur' })   // somme des valeurs (1 = jour, 0.5 = demi)
    .count({ count: 'id' })
    .where('user_id', userId)
    .groupBy('type');

  if (dateFrom) query.where('date', '>=', dateFrom);
  if (dateTo) query.where('date', '<=', dateTo);

  const rows = await query;

  const byType = {};
  let total = 0;
  let count = 0;
  for (const r of rows) {
    const jours = Number(r.jours) || 0;
    const c = Number(r.count) || 0;
    byType[r.type] = { jours, count: c };
    total += jours;
    count += c;
  }

  return { byType, total, count };
}
