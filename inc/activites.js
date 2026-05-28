import { db } from '../db.js';

const SORTABLE = new Set(['libelle', 'id', 'periode', 'numero']);

/**
 * Liste des activités sélectionnables (hors corbeille / indisponibles), triées.
 *
 * Accès restreint (un des deux identifiants fourni) : ne renvoie que les
 * activités ayant au moins une pige (non corbeille) liée à `personneId`, ou
 * créées par l'utilisateur `userId` (`createur_id`).
 *
 * @param {{sort?: string, order?: 'asc'|'desc', personneId?: number|null, userId?: number|null}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listActivites({ sort = 'periode', order = 'desc', personneId = null, userId = null } = {}) {
  const query = db('activites')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (personneId !== null || userId !== null) {
    query.where(function () {
      this.whereExists(function () {
        this.select(db.raw('1'))
          .from('piges')
          .whereRaw('piges.activite_id = activites.id')
          .andWhere('piges.personne_id', personneId ?? 0)
          .andWhere('piges.trash', '<>', 1);
      });
      if (userId !== null) {
        this.orWhere('activites.createur_id', userId);
      }
    });
  }

  const column = SORTABLE.has(String(sort)) ? sort : 'periode';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return await query.orderBy(column, direction);
}

/**
 * Récupère une activité par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getActivite(id) {
  if (isNaN(id)) throw new Error('Invalid activite ID');
  return (await db('activites')
    .where('id', id)
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .first()) ?? null;
}

/**
 * Vrai si l'utilisateur peut accéder à l'activité : il l'a créée
 * (`createur_id = userId`) ou il a au moins une pige (non corbeille) dessus
 * (`personne_id = personneId`).
 * @param {number} personneId
 * @param {number} userId
 * @param {number} activiteId
 * @returns {Promise<boolean>}
 */
export async function userCanAccessActivite(personneId, userId, activiteId) {
  const row = await db('activites')
    .select('activites.id')
    .where('activites.id', activiteId)
    .where('activites.trash', '<>', 1)
    .where(function () {
      this.where('activites.createur_id', userId ?? 0)
        .orWhereExists(function () {
          this.select(db.raw('1'))
            .from('piges')
            .whereRaw('piges.activite_id = activites.id')
            .andWhere('piges.personne_id', personneId ?? 0)
            .andWhere('piges.trash', '<>', 1);
        });
    })
    .first();
  return !!row;
}
