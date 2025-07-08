import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * @api {get} /personne Infos utilisateur connecté
 * @apiName GetCurrentPersonne
 * @apiGroup Personnes
 * @apiSuccess {Object} personne Informations de la personne
 */

router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

/**
 * @api {put} /personne Mise à jour de la personne connectée
 * @apiName UpdateCurrentPersonne
 * @apiGroup Personnes
 * @apiBody {Object} body Données de mise à jour
 * @apiSuccess {Object} personne Données mises à jour
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

