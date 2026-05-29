import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getDocumentsForPersonne, getDocument } from '../inc/systeme/documents.js';
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


export default router;

