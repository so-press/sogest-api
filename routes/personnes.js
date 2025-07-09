import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personnes';

/**
 * @api {get} /personnes Liste des personnes
 * @apiName GetPersonnes
 * @apiGroup Personnes
 * @apiUse globalToken
 * @apiSuccess {Object[]} personnes Liste des personnes
 */

router.get('/', handleResponse(async (req, res) => {
  const personnes = await getPersonnes();
  return personnes;
}));


/**
 * @api {get} /personnes/:id Détails d'une personne
 * @apiName GetPersonne
 * @apiGroup Personnes
 * @apiParam {Number} id ID de la personne
 * @apiUse globalToken
 * @apiSuccess {Object} personne Données de la personne
 */
router.get('/:id', handleResponse(async (req, res) => {
  const personne = await getPersonne({ id: req.params.id });
  return personne;
}));


/**
 * @api {put} /personnes/:id Mise à jour d'une personne
 * @apiName UpdatePersonne
 * @apiGroup Personnes
 * @apiParam {Number} id ID de la personne à modifier
 * @apiBody {Object} body Données à mettre à jour
 * @apiUse globalToken
 * @apiSuccess {Object} personne Données modifiées
 */
router.put('/:id', handleResponse(async (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const updated = await updatePersonne(id, data);
  if (updated) {
    return await getPersonne({ id: req.params.id })
  }
}));

export default router;

