import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { urlExists } from '../core/utils.js';

const SORTABLE = new Set(['libelle', 'id', 'periode', 'numero']);

/**
 * Liste des activités sélectionnables (hors corbeille / indisponibles), triées.
 *
 * Accès restreint (un des deux identifiants fourni) : ne renvoie que les
 * activités ayant au moins une pige (non corbeille) liée à `personneId`, ou
 * créées par l'utilisateur `userId` (`createur_id`).
 *
 * `supportId` restreint la liste aux activités d'un support donné.
 *
 * @param {{sort?: string, order?: 'asc'|'desc', personneId?: number|null, userId?: number|null, search?: string|null, supportId?: number|null}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listActivites({ sort = 'periode', order = 'desc', personneId = null, userId = null, search = null, supportId = null } = {}) {
  const query = db('activites')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (supportId !== null) query.where('support_id', supportId);

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

  // Recherche plein-texte (LIKE) sur le libellé affiché.
  const term = String(search ?? '').trim();
  if (term) query.where('libelle', 'like', `%${term}%`);

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

/**
 * Extensions candidates pour le fichier `couverture.*` d'une activité,
 * dans l'ordre de préférence (le legacy stocke le fichier tel qu'uploadé).
 */
const COUVERTURE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/**
 * URL de la couverture d'une activité (`uploads/files/activites/{id}/couverture.*`
 * côté SOGEST), ou `null` si aucun fichier n'existe.
 * @param {number} activiteId
 * @returns {Promise<string|null>}
 */
export async function resolveCouvertureUrl(activiteId) {
  const base = `uploads/files/activites/${activiteId}/couverture.`;
  const urls = COUVERTURE_EXTENSIONS.map((ext) => sogestUrl(base + ext));
  const found = await Promise.all(urls.map(urlExists));
  const index = found.indexOf(true);
  return index === -1 ? null : urls[index];
}

/**
 * Dernière activité en date d'un support : la plus récente par `date_bouclage`
 * (les activités sans date de bouclage passent en dernier), `id` en départage.
 * Le champ `couverture` est résolu au passage.
 * @param {number} supportId
 * @returns {Promise<Object|null>}
 */
export async function getDerniereActivitePourSupport(supportId) {
  if (isNaN(supportId)) throw new Error('Invalid support ID');

  const row = await db('activites')
    .select('*')
    .where('support_id', supportId)
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    // `YEAR() = 0` plutôt qu'une comparaison à '0000-00-00' : en sql_mode
    // strict, ce littéral de date invalide fait échouer la requête.
    .orderByRaw('(date_bouclage IS NULL OR YEAR(date_bouclage) = 0) asc')
    .orderBy('date_bouclage', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!row) return null;

  return { ...row, couverture: await resolveCouvertureUrl(row.id) };
}
