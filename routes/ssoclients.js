import express from 'express';
import { getSsoclient, getSsoclients, getSsoclientBySlug } from '../inc/ssoclients.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/ssoclients';

/**
 * @api {get} /ssoclients Liste des SSO clients
 * @apiName GetSsoclients
 * @apiGroup Ssoclients
 * @apiUse globalToken
 * @apiSuccess {Object[]} data Liste des clients SSO (client_secret exclu)
 */
router.get('/', handleResponse(async (req, res) => {
  return await getSsoclients();
}));

/**
 * @api {get} /ssoclients/:id Détails d'un SSO client
 * @apiName GetSsoclient
 * @apiGroup Ssoclients
 * @apiParam {String} id Identifiant numérique ou client_id du client SSO
 * @apiUse globalToken
 * @apiSuccess {Object} ssoclient Données du client SSO (client_secret exclu)
 * @apiError 404 Client SSO introuvable
 */
/**
 * @api {get} /ssoclients/slug/:slug Détails d'un SSO client par son slug
 * @apiName GetSsoclientBySlug
 * @apiGroup Ssoclients
 * @apiParam {String} slug Slug du client SSO
 * @apiUse globalToken
 * @apiSuccess {Object} ssoclient Données du client SSO
 * @apiError 404 Client SSO introuvable
 */
router.get('/slug/:slug', handleResponse(async (req, res) => {
  const ssoclient = await getSsoclientBySlug(req.params.slug);
  if (!ssoclient) {
    res.status(404);
    throw new Error('SSO client not found');
  }
  return ssoclient;
}));

router.get('/:ssoclientId', handleResponse(async (req, res) => {
  const ssoclient = await getSsoclient(req.params.ssoclientId);
  if (!ssoclient) {
    res.status(404);
    throw new Error('SSO client not found');
  }
  return ssoclient;
}));


export default router;
