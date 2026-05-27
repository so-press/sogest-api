import { db } from '../db.js';
import { getContrats } from './contrats.js';
import { getPiges } from './piges.js';
import { sogestBaseUrl, sogestUrl } from './sogest.js';
import { kebabToCamel, md5, choseDate } from './utils.js';

/**
 * Récupère un document précis lié à une personne (par origine et id).
 * @param {{personneId: number, origin: string, id: number}} params
 * @returns {Promise<Object|undefined>}
 */
export async function getDocument(params = {}) {
    const { personneId, origin, id } = params;
    const documents = await getDocumentsForPersonne(personneId);
    for(const document of documents) {
        if(document.document_origin != origin) continue;
        if(document.document_id != id) continue;
        return document;
    }
}

/**
 * Liste l'ensemble des documents liés à une personne (piges, contrats, uploads).
 * @param {number} personneId
 * @param {{date?: string, type?: string}} [options]
 * @returns {Promise<Object[]>}
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
                const data = { document_id: line.id, document_origin: line.type_item, type };
                if (line.type_item === 'pige') {
                    data.date = choseDate(line.creation, line.modification);
                    data.url = line.url;
                    data.infos = line.description;
                }
                if (line.type_item === 'contrat') {
                    data.date = choseDate(line.date_debut);
                    data.url = line.url;
                    data.infos = line.libelle_projet;
                }
                if (line.type_item === 'document') {
                    data.date = choseDate(line.date_creation);
                    data.type = line.type_document;
                    data.url = line.url;
                    data.infos = line.nom;
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
 * Documents téléversés pour une personne, classés par `type_document` (camelCase).
 * @param {number} personneId
 * @returns {Promise<Object<string, Object[]>>}
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
        const typeDocument = kebabToCamel(document.type_document);
        all[typeDocument] = all[typeDocument] || [];
        all[typeDocument].push(document);
    })
    return all;
}
