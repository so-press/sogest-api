import express from 'express';
import { getSupport, getSupports } from '../inc/supports.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/supports';

/**
 * @openapi
 * /supports:
 *   get:
 *     tags: [Supports]
 *     summary: Liste des supports actifs
 *     responses:
 *       200:
 *         description: Liste paginée des supports
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
  return await getSupports();
}));

/**
 * @openapi
 * /supports/{id}:
 *   get:
 *     tags: [Supports]
 *     summary: Détails d'un support
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug
 *     responses:
 *       200: { description: Données du support, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
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
