/**
 * @namespace Absences
 */
import { db } from '../db.js';

/**
 * Récupère la liste des absences d'un utilisateur.
 *
 * @param {Object} options - Options de recherche
 * @param {number} options.userId - Identifiant de l'utilisateur
 * @param {number|null} [options.year] - Filtre sur l'année
 * @param {number|null} [options.month] - Filtre sur le mois
 * @returns {Promise<Object[]>} Liste des absences
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
