/**
 * @namespace Contrats
 */
import { db } from '../db.js';
import { sogestUrl } from './sogest.js';

/**
 * @api {function} getContrats Récupère les contrats liés à une personne
 * @apiName GetContrats
 * @apiGroup Contrats
 *
 * @apiParam {Number} personneId Identifiant de la personne
 *
 * @apiSuccess {Object} contrats Objet contenant les contrats et droits d'auteur
 */
export async function getContrats(personneId) {
    const query = db('contrats')
        .select('*')
        .where('trash', '<>', 1)
        .where('personne_id', '=', personneId)
        .orderBy([{ column: 'date_debut', order: 'desc' }]);

    const contrats = await query;

    const all = { contrats: [], da: [] };
    contrats.forEach(contrat => {
        contrat.type_item = 'contrat';
        contrat.url = sogestUrl('contrat.php', { contrat_id: contrat.id });
        if (contrat.droits_auteur > 0) {
            all.da.push(contrat)
        }
        if (contrat.brut_jour > 0) {
            all.contrats.push(contrat)
        }
    })

    return all
}





