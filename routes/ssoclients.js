import express from 'express';
import { getSsoclient, getSsoclients, getSsoclientBySlug } from '../inc/ssoclients.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/ssoclients';

/**
 * @openapi
 * /ssoclients:
 *   get:
 *     tags: [SSO Clients]
 *     summary: Liste des SSO clients (client_secret exclu)
 *     responses:
 *       200:
 *         description: Liste paginée des SSO clients
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
  return await getSsoclients();
}));

/**
 * @openapi
 * /ssoclients/slug/{slug}:
 *   get:
 *     tags: [SSO Clients]
 *     summary: Détails d'un SSO client par son slug
 *     description: |
 *       Si aucun ssoclient n'a ce `slug`, le serveur cherche en fallback dans le
 *       champ `variantes` (JSON `[{clientId, clientName}, …]`) et renvoie le
 *       parent dont une variante a `clientId === slug`. Dans ce cas, `subtitle`
 *       est remplacé par le `clientName` de la variante.
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Données du SSO client, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/slug/:slug', handleResponse(async (req, res) => {
  const ssoclient = await getSsoclientBySlug(req.params.slug);
  if (!ssoclient) {
    res.status(404);
    throw new Error('SSO client not found');
  }
  return ssoclient;
}));

/**
 * @openapi
 * /ssoclients/{id}:
 *   get:
 *     tags: [SSO Clients]
 *     summary: Détails d'un SSO client par id ou client_id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou client_id
 *     responses:
 *       200: { description: Données du SSO client, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:ssoclientId', handleResponse(async (req, res) => {
  const ssoclient = await getSsoclient(req.params.ssoclientId);
  if (!ssoclient) {
    res.status(404);
    throw new Error('SSO client not found');
  }
  return ssoclient;
}));


export default router;
