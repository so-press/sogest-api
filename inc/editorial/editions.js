import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';

/**
 * URL du PDF d'une édition : son URL S3 (`editions.url`, renseignée par SOGEST
 * à l'upload ou par la migration `crons/editions_vers_s3.php`), sinon, pour une
 * édition pas encore migrée, le fichier sur SOGEST (`uploads/editions/{id}.pdf`).
 * C'est le seul endroit de l'API qui connaisse ce chemin : les activités s'y
 * adressent aussi, via leur `edition_id`.
 *
 * L'existence du fichier n'est pas vérifiée — ce serait une requête HTTP par
 * édition sur une liste.
 *
 * @param {number|null} editionId
 * @param {string|null} [url] `editions.url`
 * @returns {string|null} `null` sans édition
 */
export function pdfEditionUrl(editionId, url = null) {
  if (!editionId) return null;
  return url || sogestUrl(`uploads/editions/${editionId}.pdf`);
}

/**
 * `editions.url` de plusieurs éditions, en une requête : pour les listes
 * d'activités, qui ne portent que l'`edition_id`.
 * @param {Array<number|null>} editionIds
 * @returns {Promise<Map<number, string>>}
 */
export async function urlsPdfEditions(editionIds) {
  const ids = [...new Set(editionIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db('editions').select('id', 'url').whereIn('id', ids);
  return new Map(rows.map((row) => [row.id, row.url]));
}

/** Ajoute à une édition l'URL complète de son PDF. */
function avecPdf(edition) {
  if (!edition) return edition;
  return { ...edition, pdf: pdfEditionUrl(edition.id, edition.url) };
}

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

  return (await query.orderBy(column, direction)).map(avecPdf);
}

/**
 * Récupère une édition par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getEdition(id) {
  if (isNaN(id)) throw new Error('Invalid edition ID');
  return avecPdf(await db('editions').where('id', id).where('trash', '<>', 1).first()) ?? null;
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
