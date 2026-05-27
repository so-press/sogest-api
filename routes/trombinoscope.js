import express from 'express';
import { handleResponse } from '../inc/response.js';
import { getPermanents } from '../inc/personnes.js';

const router = express.Router();
// Base path for this router
export const routePath = '/trombinoscope';



/**
 * @openapi
 * /trombinoscope:
 *   get:
 *     tags: [Trombinoscope]
 *     summary: Personnes permanentes (trombinoscope)
 *     responses:
 *       200:
 *         description: Liste paginée des personnes permanentes
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
    const rows = await getPermanents();
    return rows;
}));

export default router;

