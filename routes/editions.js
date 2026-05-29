import express from 'express';
import { listEditions, getEdition, resolveSupportId } from '../inc/editorial/editions.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/editions';

/**
 * @openapi
 * /editions:
 *   get:
 *     tags: [Editions]
 *     summary: Liste des éditions
 *     parameters:
 *       - { in: query, name: support, schema: { type: string }, description: Filtre sur le support (id numérique ou slug) }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [publication, modification, numero, id], default: publication }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des éditions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
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
 * @openapi
 * /editions/{id}:
 *   get:
 *     tags: [Editions]
 *     summary: Détails d'une édition
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données de l'édition, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
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
