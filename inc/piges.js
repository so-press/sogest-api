/**
 * @namespace Piges
 */
import { db } from '../db.js';
import { sogestUrl } from './sogest.js';
import { kebabToCamel, slugify } from './utils.js';


/**
 * Récupère les piges d'une personne.
 *
 * @param {number} personneId - Identifiant de la personne
 * @param {Object} [options]
 * @param {string} [options.type] - Filtrer sur un type de contenu
 * @returns {Promise<Object>} Piges regroupées par type
 */
export async function getPiges(personneId, options = {}) {
    const type_contenu = options.type || '';

    const query = db('piges')
        .leftJoin('tarifs', 'piges.tarif_id', 'tarifs.id')
        .leftJoin('contenus', 'tarifs.contenu_id', 'contenus.id')
        .select(
            'piges.*',
            'contenus.type_contenu'
        )
        .where('piges.trash', '<>', 1)
        .where('piges.personne_id', '=', personneId)
        .orderBy([{ column: 'piges.id', order: 'desc' }]);

    if (type_contenu) {
        query.where('contenus.type_contenu', type_contenu);
    }
    const piges = await query;

    const all = {};
    piges.forEach(pige => {
        pige.type_item = 'pige';
        const tarif = slugify(pige.type_contenu) || 'remuneration';
        if (tarif == 'da') {
            pige.url = sogestUrl(`action.php`, { w: 'telecharger_da', 'pige_id': pige.id });
        }

        all[tarif] = all[tarif] || [];
        all[tarif].push(pige);
    });

    return all;
}




/**
 * Récupère la liste des tarifs pour les droits d'auteur.
 * @returns {Promise<Object[]>} Tarifs disponibles
 */
async function getTarifsDa() {
    const tarifs = await db('tarifs')
        .leftJoin('contenus', 'contenus.id', 'tarifs.contenu_id')
        .select('tarifs.*', 'contenus.*')
        .where('contenus.type_contenu', 'da');

    return tarifs;
}
