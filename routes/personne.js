import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * @openapi
 * /personne:
 *   get:
 *     summary: Infos utilisateur connecté
 *     tags:
 *       - Personnes
 *     responses:
 *       200:
 *         description: Informations de la personne
 */

router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

/**
 * @openapi
 * /personne:
 *   put:
 *     summary: Mise à jour de la personne connectée
 *     tags:
 *       - Personnes
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Données mises à jour
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

