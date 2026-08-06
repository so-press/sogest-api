import { db } from '../../db.js';
import { getContrats } from '../rh/contrats.js';
import { getPiges } from '../editorial/piges.js';
import { sogestUrl } from '../core/sogest.js';
import { getRequest } from '../core/request.js';
import { kebabToCamel, choseDate } from '../core/utils.js';

/**
 * Construction de l'URL SOGEST réelle d'un document, par origine.
 * Ces URLs ne sont **jamais** exposées au client : elles ne sont utilisables
 * que serveur-à-serveur (cf. `fetchDocumentFile`), le navigateur ne pouvant pas
 * poser d'en-tête `Authorization` sur une simple navigation.
 */
const DOCUMENT_SOURCES = {
    document: (id) => sogestUrl('document.php', { document_id: id }),
    contrat: (id) => sogestUrl('contrat.php', { contrat_id: id }),
    pige: (id) => sogestUrl('action.php', { w: 'telecharger_da', pige_id: id }),
};

/**
 * Base publique de l'API : `BASE_URL` si défini, sinon déduite de la requête en
 * cours (en honorant `X-Forwarded-Proto` derrière un reverse proxy). Chaîne vide
 * en dernier recours : les URLs produites sont alors relatives, ce qui reste
 * exploitable par un client qui a déjà l'API pour base.
 * @returns {string}
 */
function apiBaseUrl() {
    const configured = (process.env.BASE_URL || '').trim();
    if (configured) return configured.replace(/\/+$/, '');

    const req = getRequest();
    if (!req) return '';

    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return `${forwarded || req.protocol}://${req.get('host')}`;
}

/**
 * URL de téléchargement d'un document, proxifiée par l'API.
 * C'est la seule URL exposée aux clients : elle exige le JWT sogest (comme le
 * reste de l'API) et l'API relaie ensuite le fichier depuis SOGEST.
 * @param {string} origin `document` | `contrat` | `pige`
 * @param {number|string} id
 * @returns {string}
 */
export function documentFileUrl(origin, id) {
    return `${apiBaseUrl()}/documents/${encodeURIComponent(origin)}/${encodeURIComponent(id)}/fichier`;
}

/**
 * Récupère le binaire d'un document depuis SOGEST.
 * Le JWT de l'appelant est retransmis : SOGEST accepte le même token (même
 * `JWT_SECRET`, cf. `include/auto/auth.inc.php`) et refait donc son propre
 * contrôle de droits en plus de celui déjà fait ici.
 * @param {{document_origin: string, document_id: number|string}} document
 * @param {{authorization?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{buffer: Buffer, contentType: string, contentDisposition: string}>}
 */
export async function fetchDocumentFile(document, options = {}) {
    const { authorization, timeoutMs = 30000 } = options;

    const source = DOCUMENT_SOURCES[document?.document_origin];
    if (!source) {
        const err = new Error(`Origine de document inconnue : ${document?.document_origin}`);
        err.status = 404;
        throw err;
    }

    const headers = {};
    if (authorization) headers.Authorization = authorization;

    let upstream;
    try {
        upstream = await fetch(source(document.document_id), {
            headers,
            // `manual` : une redirection signifie que SOGEST n'a pas accepté le
            // JWT et renvoie vers son formulaire de login — on ne veut surtout
            // pas relayer cette page HTML comme si c'était le document.
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        const err = new Error(`SOGEST injoignable : ${e.message}`);
        err.status = 502;
        throw err;
    }

    if (upstream.status >= 300 && upstream.status < 400) {
        const err = new Error('SOGEST a refusé le token et redirige vers son login');
        err.status = 502;
        throw err;
    }

    if (!upstream.ok) {
        const err = new Error(`SOGEST a répondu ${upstream.status} : ${(await upstream.text()).slice(0, 200)}`);
        err.status = upstream.status === 404 ? 404 : 502;
        throw err;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) {
        const err = new Error('SOGEST a renvoyé une page HTML au lieu du fichier');
        err.status = 502;
        throw err;
    }

    return {
        buffer: Buffer.from(await upstream.arrayBuffer()),
        contentType,
        contentDisposition:
            upstream.headers.get('content-disposition') ||
            `attachment; filename="sogest-${document.document_origin}-${document.document_id}.pdf"`,
    };
}

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
                    data.infos = line.description;
                }
                if (line.type_item === 'contrat') {
                    data.date = choseDate(line.date_debut);
                    data.infos = line.libelle_projet;
                }
                if (line.type_item === 'document') {
                    data.date = choseDate(line.date_creation);
                    data.type = line.type_document;
                    data.infos = line.nom;
                    data.nom_document = line.nom_document;
                }
                // Toujours l'URL proxifiée par l'API : `line.url` pointe sur
                // SOGEST et n'est pas téléchargeable depuis un navigateur.
                data.url = documentFileUrl(line.type_item, line.id);
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
