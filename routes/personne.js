import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * Récupère les informations de la personne connectée.
 *
 * @route GET /
 * @returns {Object} Informations personnelles de l'utilisateur.
 * @throws {Error} En cas d’erreur lors de la récupération.
 */

router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

/**
 * Met à jour les informations de la personne connectée.
 *
 * @route PUT /
 * @param {Object} req.body - Données à mettre à jour.
 * @returns {Object} Données mises à jour.
 * @throws {Error} En cas d’erreur lors de la mise à jour.
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
