import { db } from '../../db.js';
import { getRequest } from '../core/request.js';

// Table dédiée à l'historique des actions sur les absences (cf. sql/absences_historique.sql)
const TABLE = 'absences_historique';

// Colonnes autorisées pour le tri de l'historique
const SORTABLE = new Set(['dateheure', 'date', 'action', 'id']);

/**
 * Identité de l'auteur de l'action, déduite de la requête courante.
 * @returns {{auteur_id: number|null, auteur: string|null, ip: string|null}}
 */
function getAuteur() {
  const req = getRequest();
  const user = req?.user;
  return {
    auteur_id: user?.id ?? null,
    auteur: user?.nomComplet ?? null,
    ip: req?.ip ?? null,
  };
}

/**
 * Enregistre une action sur une absence dans l'historique dédié.
 * Ne doit jamais faire échouer l'action métier : les erreurs sont loguées, pas propagées.
 *
 * @param {'create'|'update'|'delete'} action
 * @param {{avant?: Object|null, apres?: Object|null}} etats État de l'absence avant/après l'action
 * @returns {Promise<void>}
 */
export async function logAbsence(action, { avant = null, apres = null } = {}) {
  const ref = apres ?? avant;
  if (!ref) return;

  try {
    await db(TABLE).insert({
      action,
      absence_id: ref.id,
      user_id: ref.user_id,
      date: ref.date,
      type: ref.type,
      valeur: ref.valeur,
      avant: avant ? JSON.stringify(avant) : null,
      apres: apres ? JSON.stringify(apres) : null,
      ...getAuteur(),
    });
  } catch (err) {
    console.error(`⚠️  Historique absence (${action}) non enregistré :`, err.message);
  }
}

/**
 * Liste filtrée de l'historique des absences.
 * Les champs `avant` / `apres` sont renvoyés décodés.
 *
 * @param {{userId?: number, absenceId?: number, action?: string, auteurId?: number, dateFrom?: string, dateTo?: string, sort?: string, order?: 'asc'|'desc'}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listAbsencesHistorique({
  userId = null,
  absenceId = null,
  action = null,
  auteurId = null,
  dateFrom = null,
  dateTo = null,
  sort = 'dateheure',
  order = 'desc',
} = {}) {
  const query = db(TABLE).select('*');

  if (userId !== null) {
    if (isNaN(userId)) throw new Error('Invalid user ID');
    query.where('user_id', userId);
  }
  if (absenceId !== null) {
    if (isNaN(absenceId)) throw new Error('Invalid absence ID');
    query.where('absence_id', absenceId);
  }
  if (auteurId !== null) {
    if (isNaN(auteurId)) throw new Error('Invalid author ID');
    query.where('auteur_id', auteurId);
  }
  if (action) query.where('action', action);
  // Filtre sur la date de l'action (et non sur la date de l'absence)
  if (dateFrom) query.where('dateheure', '>=', `${dateFrom} 00:00:00`);
  if (dateTo) query.where('dateheure', '<=', `${dateTo} 23:59:59`);

  const column = SORTABLE.has(String(sort)) ? sort : 'dateheure';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const rows = await query.orderBy(column, direction);

  return rows.map((row) => ({
    ...row,
    avant: parseJson(row.avant),
    apres: parseJson(row.apres),
  }));
}

/**
 * Décode une colonne JSON en tolérant les valeurs nulles ou corrompues.
 * @param {string|null} value
 * @returns {Object|null}
 */
function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
