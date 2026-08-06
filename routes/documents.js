import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getDocumentsForPersonne, getDocument, fetchDocumentFile } from '../inc/systeme/documents.js';
import { handleResponse } from '../inc/core/response.js';

dotenv.config();
const router = express.Router();

export const routePath = '/documents';
export const requireAuth = true;

/**
 * @openapi
 * /documents:
 *   get:
 *     tags: [Documents]
 *     summary: Documents de l'utilisateur connecté
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200:
 *         description: Liste paginée des documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
    const { user } = req

    const documents = await getDocumentsForPersonne(user.personne_id);

    return documents
}));

/**
 * @openapi
 * /documents/{origin}/{id}:
 *   get:
 *     tags: [Documents]
 *     summary: Détails d'un document de l'utilisateur connecté
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: origin, required: true, schema: { type: string } }
 *       - { in: path, name: id,     required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Données du document, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:origin/:id', handleResponse(async (req, res) => {
    const { origin, id } = req.params;
    const { user } = req

    const document = await getDocument({origin, id, personneId : user.personne_id});

    return document
}));

/**
 * @openapi
 * /documents/{origin}/{id}/fichier:
 *   get:
 *     tags: [Documents]
 *     summary: Télécharge le fichier d'un document de l'utilisateur connecté
 *     description: >
 *       Relaie le binaire depuis SOGEST après avoir vérifié que le document
 *       appartient bien à l'utilisateur porté par le JWT. C'est l'URL renvoyée
 *       dans le champ `url` de `GET /documents` : les URLs SOGEST directes ne
 *       sont pas exposées, un navigateur ne pouvant pas les authentifier.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: origin, required: true, schema: { type: string, enum: [document, contrat, pige] } }
 *       - { in: path, name: id,     required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Le fichier (PDF le plus souvent)
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       502: { description: SOGEST injoignable ou réponse inattendue }
 */
router.get('/:origin/:id/fichier', async (req, res) => {
    try {
        const { origin, id } = req.params;
        const { user } = req;

        // getDocument ne cherche que dans les documents de cette personne :
        // un id qui ne lui appartient pas est un 404, pas une fuite.
        const document = await getDocument({ origin, id, personneId: user.personne_id });
        if (!document) {
            res.status(404).json({ error: 'Document not found' });
            return;
        }

        const file = await fetchDocumentFile(document, {
            authorization: req.headers.authorization,
        });

        res.set('Content-Type', file.contentType);
        res.set('Content-Disposition', file.contentDisposition);
        res.send(file.buffer);
    } catch (err) {
        console.error(err);
        const status = err.status || 500;
        res.status(status).json({
            error: status === 500 ? 'Server error' : err.message,
            message: '' + err,
        });
    }
});


export default router;

