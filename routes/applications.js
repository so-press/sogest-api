import express from 'express';
import { getApplications, getApplication } from '../inc/editorial/applications.js';
import { handleResponse } from '../inc/core/response.js';
import { isAdminRequest } from '../inc/core/access.js';

const router = express.Router();
export const routePath = '/applications';

/**
 * @openapi
 * /applications:
 *   get:
 *     tags: [Applications]
 *     summary: Applications SO PRESS (outils internes)
 *     description: |
 *       Applications actives, dans l'ordre voulu par sogest (option `ORDRE_APPLICATIONS`),
 *       chacune avec son `logo` (URL ou `null`) et la liste des `groupes` (ids) auxquels
 *       elle appartient. Une application peut être rangée dans 0, 1 ou plusieurs groupes.
 *       Penser à `?limit=` : la liste est paginée (50 par défaut).
 *     parameters:
 *       - { in: query, name: groupe, schema: { type: integer }, description: "Restreint aux applications de ce groupe" }
 *       - { in: query, name: toutes, schema: { type: boolean, default: false }, description: "Inclut les applications inactives (admin uniquement, ignoré sinon)" }
 *     responses:
 *       200:
 *         description: Liste paginée des applications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { $ref: '#/components/schemas/Application' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req) => {
  const groupeId = parseInt(req.query.groupe, 10) || null;
  const toutes = isAdminRequest(req)
    && ['1', 'true', 'yes'].includes(String(req.query.toutes).toLowerCase());
  return await getApplications({ groupeId, toutes });
}));

/**
 * @openapi
 * /applications/{id}:
 *   get:
 *     tags: [Applications]
 *     summary: Détails d'une application
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: L'application, content: { application/json: { schema: { $ref: '#/components/schemas/Application' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id(\\d+)', handleResponse(async (req) => {
  return await getApplication(parseInt(req.params.id, 10));
}));

export default router;
