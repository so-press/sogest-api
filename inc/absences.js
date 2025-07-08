/**
 * @namespace Absences
 */
import { db } from '../db.js';

/**
 * @api {function} getAbsences Récupère la liste des absences d'un utilisateur
 * @apiName GetAbsences
 * @apiGroup Absences
 *
 * @apiParam {Object} options Options de recherche
 * @apiParam {Number} options.userId Identifiant de l'utilisateur
 * @apiParam {Number} [options.year] Filtre sur l'année
 * @apiParam {Number} [options.month] Filtre sur le mois
 *
 * @apiSuccess {Object[]} absences Liste des absences
 */
export async function getAbsences({ userId, year = null, month = null }) {
  if (isNaN(userId)) throw new Error('Invalid user ID');

  const query = db('absences')
    .where('user_id', userId);

  if (year !== null) {
    if (isNaN(year)) throw new Error('Invalid year');
    query.andWhereRaw('YEAR(date) = ?', [year]);
  }

  if (month !== null) {
    if (isNaN(month) || month < 1 || month > 12) throw new Error('Invalid month');
    query.andWhereRaw('MONTH(date) = ?', [month]);
  }

  return await query.orderBy('date', 'desc');
}
