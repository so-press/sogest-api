import { db } from '../db.js';

const SORTABLE = new Set(['libelle', 'id', 'date_debut', 'date_fin']);

/**
 * Liste des projets sélectionnables (hors corbeille / indisponibles), triés.
 *
 * Si `personneId` est fourni (accès restreint), ne renvoie que les projets
 * ayant au moins un contrat (non corbeille) lié à cette personne, ou dont elle
 * est la responsable (`responsable_id`).
 *
 * @param {{sort?: string, order?: 'asc'|'desc', personneId?: number|null}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listProjets({ sort = 'date_debut', order = 'desc', personneId = null } = {}) {
  const query = db('projets')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (personneId !== null) {
    query.where(function () {
      this.where('projets.responsable_id', personneId)
        .orWhereExists(function () {
          this.select(db.raw('1'))
            .from('contrats')
            .whereRaw('contrats.projet_id = projets.id')
            .andWhere('contrats.personne_id', personneId)
            .andWhere('contrats.trash', '<>', 1);
        });
    });
  }

  const column = SORTABLE.has(String(sort)) ? sort : 'date_debut';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return await query.orderBy(column, direction);
}

/**
 * Récupère un projet par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getProjet(id) {
  if (isNaN(id)) throw new Error('Invalid projet ID');
  return (await db('projets')
    .where('id', id)
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .first()) ?? null;
}

/**
 * Vrai si la personne peut accéder au projet : elle en est la responsable
 * (`responsable_id`) ou elle a au moins un contrat (non corbeille) dessus.
 * @param {number} personneId
 * @param {number} projetId
 * @returns {Promise<boolean>}
 */
export async function personneCanAccessProjet(personneId, projetId) {
  if (!personneId) return false;
  const row = await db('projets')
    .select('projets.id')
    .where('projets.id', projetId)
    .where(function () {
      this.where('projets.responsable_id', personneId)
        .orWhereExists(function () {
          this.select(db.raw('1'))
            .from('contrats')
            .whereRaw('contrats.projet_id = projets.id')
            .andWhere('contrats.personne_id', personneId)
            .andWhere('contrats.trash', '<>', 1);
        });
    })
    .first();
  return !!row;
}
