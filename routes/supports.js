import express from 'express';
import { getSupport, getSupports } from '../inc/supports.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/supports';

/**
 * @api {get} /supports Liste des supports
 * @apiName GetSupports
 * @apiGroup Supports
 * @apiUse globalToken
 * @apiSuccess {Object[]} data Liste des supports actifs
 */
router.get('/', handleResponse(async (req, res) => {
  return await getSupports();
}));

/**
 * @api {get} /supports/:id Détails d'un support
 * @apiName GetSupport
 * @apiGroup Supports
 * @apiParam {String} id Identifiant numérique ou slug du support
 * @apiUse globalToken
 * @apiSuccess {Object} support Données du support
 * @apiError 404 Support introuvable
 */
router.get('/:supportId', handleResponse(async (req, res) => {
  const support = await getSupport(req.params.supportId);
  if (!support) {
    res.status(404);
    throw new Error('Support not found');
  }
  return support;
}));

export default router;
