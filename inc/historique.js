/**
 * @namespace Historique
 */
import { db } from '../db.js';
import { getRequest } from './request.js';
/**
 * Sauvegarde l'état actuel d'une ligne d'une table dans la table historique
 *
 * @param {string} tableName Nom de la table à sauvegarder
 * @param {number} rowId ID de la ligne à récupérer
 * @param {Object} user Utilisateur courant ({ id, nom })
 */
export async function saveToHistorique(tableName, rowId) {
    const req = getRequest();
    const { user } = req;
    const currentData = await db(tableName).where({ id: rowId }).first();
    if (!currentData) return;

    await db('historique').insert({
        table: tableName,
        cle: rowId,
        donnee: JSON.stringify(currentData),
        user: user.nomComplet,
        user_id: user.id
    });
}


/**
 * Récupère l'historique d'une table, filtré par identifiant de ligne, utilisateur et/ou date
 * Le champ "donnee" est exclu des résultats
 *
 * @param {Object} options Options de filtre
 * @param {string} options.table Nom de la table (obligatoire)
 * @param {number} [options.id] ID de la ligne à filtrer (cle)
 * @param {number} [options.user_id] ID de l'utilisateur à filtrer
 * @param {string} [options.date] Date au format YYYY-MM-DD pour filtrer les enregistrements de cette journée
 * @returns {Promise<Array>} Liste des entrées historiques sans le champ "donnee"
 */
export async function getHistorique(options = {}) {
    const { table, id, user_id, date } = options;

    if (!table) {
        throw new Error('Le paramètre "table" est obligatoire');
    }

    const query = db('historique')
        .where({ table })
        .select('id', 'table', 'cle', 'user', 'user_id', 'dateheure');

    if (id) {
        query.andWhere({ cle: id });
    }

    if (user_id) {
        query.andWhere({ user_id });
    }

    if (date) {
        query.andWhereRaw('DATE(dateheure) = ?', [date]);
    }

    return await query.orderBy('dateheure', 'desc');
}

/**
 * Récupère une version unique de l'historique par son ID ou par (table + cle),
 * avec décodage du champ "donnee"
 *
 * @param {number|Object} options Soit un ID, soit un objet { table, cle }
 * @returns {Promise<Object|null>} Objet contenant les données de l'évènement, ou null si non trouvé
 */
export async function getVersion(options) {
    let query = db('historique');

    const { id, table, cle } = options;
    if (id) {
        query = query.where({ id });
    } else if (table && cle) {
        query = query.where({
            table, cle
        }).orderBy('dateheure', 'desc').limit(1);
    } else {
        throw new Error('Paramètre invalide : fournir un { id } ou { table, cle }');
    }

    const row = await query.first();
    if (!row) return null;

    return {
        id: row.id,
        table: row.table,
        cle: row.cle,
        user: row.user,
        user_id: row.user_id,
        dateheure: row.dateheure,
        donnee: JSON.parse(row.donnee)
    };
}
