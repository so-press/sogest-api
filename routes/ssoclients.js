import express from 'express';
import { getSsoclient, getSsoclients } from '../inc/auth/ssoclients.js';
import { handleResponse } from '../inc/core/response.js';

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
 * /ssoclients/{id}:
 *   get:
 *     tags: [SSO Clients]
 *     summary: Détails d'un SSO client par id ou client_id
 *     description: |
 *       Fallback variantes : si la valeur n'est pas numérique et qu'aucun
 *       ssoclient n'a ce `client_id`, le serveur cherche dans le champ
 *       `variantes` (JSON `[{clientId, clientName}, …]`) de chaque ssoclient
 *       et renvoie le parent dont une variante a `clientId === <valeur>`.
 *       Dans ce cas, la réponse est « projetée » comme si la variante était
 *       le client lui-même : `client_id` et `subtitle` sont remplacés par les
 *       `clientId`/`clientName` de la variante, et le champ `variantes` est
 *       omis de la réponse.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou client_id (avec fallback variantes)
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
