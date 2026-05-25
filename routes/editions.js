import express from 'express';
import { listEditions, getEdition, resolveSupportId } from '../inc/editions.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/editions';

/**
 * @api {get} /editions Liste des éditions
 * @apiName ListEditions
 * @apiGroup Editions
 * @apiQuery {String} [support] Filtre sur le support (id numérique ou slug)
 * @apiQuery {String} [sort=publication] Colonne de tri (publication, modification, numero, id)
 * @apiQuery {String} [order=desc] Sens du tri (asc|desc)
 * @apiQuery {Number} [page] Page (pagination)
 * @apiQuery {Number} [limit=50] Nombre d'éléments par page
 * @apiUse globalToken
 * @apiSuccess {Object[]} data Liste paginée des éditions
 */
router.get('/', handleResponse(async (req, res) => {
  const { support, sort, order } = req.query;

  let supportId = null;
  if (support !== undefined && support !== '') {
    supportId = await resolveSupportId(support);
    if (supportId === null) {
      res.status(404);
      throw new Error('Support not found');
    }
  }

  return await listEditions({ supportId, sort, order });
}));

/**
 * @api {get} /editions/:id Détails d'une édition
 * @apiName GetEdition
 * @apiGroup Editions
 * @apiParam {Number} id Identifiant de l'édition
 * @apiUse globalToken
 * @apiSuccess {Object} edition Données de l'édition
 * @apiError 404 Edition introuvable
 */
router.get('/:id', handleResponse(async (req, res) => {
  const edition = await getEdition(parseInt(req.params.id, 10));
  if (!edition) {
    res.status(404);
    throw new Error('Edition not found');
  }
  return edition;
}));

export default router;
