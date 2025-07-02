import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * @api {get} /personne Retrieve authenticated user's personne
 * @apiName GetAuthenticatedPersonne
 * @apiGroup Personnes
 * @apiHeader {String} Authorization Bearer JWT token.
 * @apiSuccess {Object} personne Personne linked to the token.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Personne\ auth.bru doc/Personne auth.bru}.
 */

router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

export default router;
