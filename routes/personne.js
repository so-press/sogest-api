import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/rh/personnes.js';
import { handleResponse } from '../inc/core/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * @openapi
 * /personne:
 *   get:
 *     tags: [Personne]
 *     summary: Infos de la personne liée à l'utilisateur connecté
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Informations de la personne, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

/**
 * @openapi
 * /personne:
 *   put:
 *     tags: [Personne]
 *     summary: Mise à jour de la personne connectée
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: true }
 *     responses:
 *       200: { description: Données mises à jour, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/', handleResponse(async (req, res) => {
    const { user } = req
    const data = req.body;
    const updated = await updatePersonne(user.personne_id, data);
    if (updated) {
        return await getPersonne({ id: user.personne_id })
    }
}));
export default router;

