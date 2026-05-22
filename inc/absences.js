/**
 * @namespace Absences
 */
import dayjs from 'dayjs';
import { db } from '../db.js';

// Colonnes autorisées pour le tri (évite toute injection via ?sort=)
const SORTABLE = new Set(['date', 'valeur', 'type', 'creation', 'id']);
// Champs modifiables d'une absence (le rattachement user_id n'est pas modifiable)
const EDITABLE = ['date', 'type', 'valeur'];

/**
 * @api {function} listAbsences Liste filtrée et triée des absences
 * @apiName ListAbsences
 * @apiGroup Absences
 *
 * @apiParam {Object} [options] Filtres
 * @apiParam {Number} [options.userId] Filtre sur l'utilisateur
 * @apiParam {String} [options.type] Filtre sur le type d'absence
 * @apiParam {String} [options.dateFrom] Date de début (incluse, YYYY-MM-DD)
 * @apiParam {String} [options.dateTo] Date de fin (incluse, YYYY-MM-DD)
 * @apiParam {Number} [options.year] Filtre sur l'année
 * @apiParam {Number} [options.month] Filtre sur le mois (1-12)
 * @apiParam {String} [options.sort=date] Colonne de tri
 * @apiParam {String} [options.order=desc] Sens du tri (asc|desc)
 *
 * @apiSuccess {Object[]} absences Liste des absences
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
 * @api {function} getAbsence Récupère une absence par son id
 * @apiName GetAbsence
 * @apiGroup Absences
 *
 * @apiParam {Number} id Identifiant de l'absence
 * @apiSuccess {Object|null} absence L'absence, ou null si introuvable
 */
export async function getAbsence(id) {
  if (isNaN(id)) throw new Error('Invalid absence ID');
  return (await db('absences').where('id', id).first()) ?? null;
}

/**
 * @api {function} findAbsence Recherche une absence pour un utilisateur à une date
 * @apiName FindAbsence
 * @apiGroup Absences
 *
 * @apiParam {Number} userId Identifiant de l'utilisateur
 * @apiParam {String} date Date (YYYY-MM-DD)
 * @apiSuccess {Object|null} absence L'absence existante, ou null
 */
export async function findAbsence(userId, date) {
  return (await db('absences').where({ user_id: userId, date }).first()) ?? null;
}

/**
 * @api {function} createAbsence Crée une absence
 * @apiName CreateAbsence
 * @apiGroup Absences
 *
 * @apiParam {Object} data Données de l'absence
 * @apiParam {Number} data.user_id Identifiant de l'utilisateur
 * @apiParam {String} data.date Date (YYYY-MM-DD)
 * @apiParam {String} [data.type=conge] Type d'absence
 * @apiParam {Number} [data.valeur=1] Valeur (1 = journée, 0.5 = demi-journée)
 *
 * @apiSuccess {Object} absence L'absence créée
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
 * @api {function} updateAbsence Met à jour une absence
 * @apiName UpdateAbsence
 * @apiGroup Absences
 *
 * @apiParam {Number} id Identifiant de l'absence
 * @apiParam {Object} data Champs à modifier (user_id, date, type, valeur)
 * @apiSuccess {Boolean} updated true si une ligne a été modifiée
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
 * @api {function} deleteAbsence Supprime une absence
 * @apiName DeleteAbsence
 * @apiGroup Absences
 *
 * @apiParam {Number} id Identifiant de l'absence
 * @apiSuccess {Boolean} deleted true si une ligne a été supprimée
 */
export async function deleteAbsence(id) {
  if (isNaN(id)) throw new Error('Invalid absence ID');
  const count = await db('absences').where('id', id).del();
  return count > 0;
}
