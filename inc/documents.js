/**
 * @namespace Documents
 */
import { db } from '../db.js';
import { getContrats } from './contrats.js';
import { getPiges } from './piges.js';
import { sogestBaseUrl, sogestUrl } from './sogest.js';
import { kebabToCamel, md5, choseDate } from './utils.js';

/**
 * @api {function} getDocumentsForPersonne Récupère l'ensemble des documents liés à une personne
 * @apiName GetDocumentsForPersonne
 * @apiGroup Documents
 *
 * @apiParam {Number} personneId Identifiant de la personne
 * @apiParam {Object} [options] Options de filtrage
 *
 * @apiSuccess {Object[]} documents Liste formatée des documents
 */
export async function getDocumentsForPersonne(personneId, options = {}) {
    const contrats = await getContrats(personneId);
    const piges = await getPiges(personneId, { type: 'da' });
    const documents = await getUploadedDocuments(personneId);

    const all = [piges, contrats, documents];
    const final = [];

    for (const struct of all) {
        for (const type in struct) {
            if (!Object.hasOwn(struct, type)) continue;
            const lines = struct[type];
            for (const line of lines) {
                const data = { document_id: line.id, document_origin : line.type_item, type };
                if (line.type_item === 'pige') {
                    data.date = choseDate(line.creation, line.modification);
                    data.url = line.url;
                    data.infos = line.description;
                    data.nom_document = line.nom_document;
                }
                if (line.type_item === 'contrats') {
                    data.date = choseDate(line.date_debut);
                    data.url = line.url;
                    data.infos = line.libelle_projet;
                    data.nom_document = line.nom_document;
                }
                if (line.type_item === 'document') {
                    data.date = choseDate(line.date_creation);
                    data.type = line.type_document;
                    data.url = line.url;
                    data.infos = line.nom;
                    data.nom_document = line.nom_document;
                }
                final.push(data);
            }
        }
    }

    const filtered = final.filter(item => {
        if (options.date && !item.date.startsWith(options.date)) return false;
        if (options.type && item.type !== options.type) return false;
        return true;
    });

    return filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
}



/**
 * @api {function} getUploadedDocuments Retourne les documents téléversés pour une personne
 * @apiName GetUploadedDocuments
 * @apiGroup Documents
 *
 * @apiParam {Number} personneId Identifiant de la personne
 *
 * @apiSuccess {Object} documents Documents classés par type
 */
export async function getUploadedDocuments(personneId) {
    const query = db('documents')
        .select('*')
        .where('trash', '<>', 1)
        .where('personne_id', '=', personneId)
        .orderBy([{ column: 'id', order: 'desc' }]);

    const documents = await query;
    const all = {};
    documents.forEach(document => {
        document.type_item = 'document';
        document.meta = document.meta ? JSON.parse(document.meta) : '';
        document.url = sogestUrl(`document.php`, { document_id: document.id });
        document.nom = document.nom ?? '';
        document.nom_document = document.nom_document ?? '';
        const typeDocument = kebabToCamel(document.type_document);
        all[typeDocument] = all[typeDocument] || [];
        all[typeDocument].push(document);
    })
    return all;
}




