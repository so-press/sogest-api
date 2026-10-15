import express from 'express';
import { getGroupes, getGroupe, getApplications } from '../inc/editorial/applications.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/groupes-applications';

/**
 * @openapi
 * /groupes-applications:
 *   get:
 *     tags: [Applications]
 *     summary: Groupes d'applications
 *     description: |
 *       Groupes servant à ranger les applications (nom, description, logo). Une application
 *       peut appartenir à plusieurs groupes. `nb_applications` ne compte que les applications actives.
 *     responses:
 *       200:
 *         description: Liste paginée des groupes, triés par `ordre` puis nom
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { $ref: '#/components/schemas/GroupeApplications' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async () => await getGroupes()));

/**
 * @openapi
 * /groupes-applications/{id}:
 *   get:
 *     tags: [Applications]
 *     summary: Détails d'un groupe d'applications
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Le groupe, content: { application/json: { schema: { $ref: '#/components/schemas/GroupeApplications' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id(\\d+)', handleResponse(async (req) => {
  return await getGroupe(parseInt(req.params.id, 10));
}));

/**
 * @openapi
 * /groupes-applications/{id}/applications:
 *   get:
 *     tags: [Applications]
 *     summary: Applications actives d'un groupe
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Liste paginée des applications du groupe
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { $ref: '#/components/schemas/Application' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id(\\d+)/applications', handleResponse(async (req) => {
  const id = parseInt(req.params.id, 10);
  await getGroupe(id); // 404 si le groupe n'existe pas
  return await getApplications({ groupeId: id });
}));

export default router;
