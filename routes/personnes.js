import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personnes';

/**
 * @api {get} /personnes List all personnes
 * @apiName GetPersonnes
 * @apiGroup Personnes
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam (Query) {Number{1..}} [page=1] Page number.
 * @apiParam (Query) {Number{1..}} [limit=50] Items per page.
 * @apiSuccess {Object[]} data Array of personnes.
 * @apiSuccess {Object}   pagination Pagination information.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Personnes.bru doc/Personnes.bru}.
 */

router.get('/', handleResponse(async (req, res) => {
  const personnes = await getPersonnes();
  return personnes;
}));
/**
 * @api {get} /personnes/:id Get personne by id
 * @apiName GetPersonne
 * @apiGroup Personnes
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam {Number} id Personne identifier.
 * @apiSuccess {Object} personne Personne object.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Personne.bru doc/Personne.bru}.
 */

router.get('/:id', handleResponse(async (req, res) => {
  const personne = await getPersonne({ id: req.params.id });
  return personne;
}));

/**
 * @api {put} /personnes/:id Update personne
 * @apiName UpdatePersonne
 * @apiGroup Personnes
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam {Number} id Personne identifier.
 * @apiBody {Object} data Allowed fields such as nom, prenom, email, etc.
 * @apiSuccess {Object} personne Updated personne object.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Personne Update.bru doc/Personne Update.bru}.
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
