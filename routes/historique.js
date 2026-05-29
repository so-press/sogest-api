import express from 'express';
import { handleResponse } from '../inc/core/response.js';
import { getHistorique } from '../inc/systeme/historique.js';

const router = express.Router();
// Base path for this router
export const routePath = '/historique';



/**
 * @openapi
 * /historique/{table}/{id}:
 *   get:
 *     tags: [Historique]
 *     summary: Historique de modifications d'une ressource
 *     parameters:
 *       - { in: path, name: table, required: true, schema: { type: string } }
 *       - { in: path, name: id,    required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Lignes d'historique
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/:table/:id', handleResponse(async (req, res) => {
    const { table, id } = req.params;
    const historique = await getHistorique({
        table, id
    });
    return historique;
}));

export default router;

