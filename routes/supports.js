import express from 'express';
import { getSupport, getSupports } from '../inc/editorial/supports.js';
import { getUserSupportIds } from '../inc/rh/users.js';
import { isAdminRequest } from '../inc/core/access.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/supports';

/**
 * @openapi
 * /supports:
 *   get:
 *     tags: [Supports]
 *     summary: Liste des supports actifs
 *     description: |
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit tous les supports. Un utilisateur standard ne voit que les
 *       supports de sa liste (`users.supports`) ; liste vide s'il n'en a aucun.
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
router.get('/', handleResponse(async (req) => {
  const all = await getSupports();
  if (isAdminRequest(req)) return all;
  const ids = new Set(await getUserSupportIds(req.user?.id));
  return all.filter((s) => ids.has(s.id));
}));

/**
 * @openapi
 * /supports/{id}:
 *   get:
 *     tags: [Supports]
 *     summary: Détails d'un support
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux supports de sa liste
 *       (`users.supports`), sinon `403`. Les admins / token statique accèdent à tout.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug
 *     responses:
 *       200: { description: Données du support, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:supportId', handleResponse(async (req, res) => {
  const support = await getSupport(req.params.supportId);
  if (!support) {
    res.status(404);
    throw new Error('Support not found');
  }
  if (!isAdminRequest(req)) {
    const ids = new Set(await getUserSupportIds(req.user?.id));
    if (!ids.has(support.id)) {
      res.status(403);
      throw new Error('Support hors de votre périmètre');
    }
  }
  return support;
}));

export default router;
