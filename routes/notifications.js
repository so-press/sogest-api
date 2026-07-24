import express from 'express';
import {
  getNotifications,
  getNotificationsByUser,
  markNotificationRead
} from '../inc/systeme/notifications.js';
import { getPersonne } from '../inc/rh/personnes.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/notifications';

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Notifications de l'utilisateur courant
 *     responses:
 *       200:
 *         description: Liste paginée des notifications
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
  return await getNotificationsByUser(req.user.id);
}));

/**
 * @openapi
 * /notifications/{id}/lue:
 *   put:
 *     tags: [Notifications]
 *     summary: Marque une notification de l'utilisateur courant comme lue
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Notification marquée comme lue, content: { application/json: { schema: { type: object, properties: { success: { type: boolean } } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/:id/lue', handleResponse(async (req) => {
  await markNotificationRead(req.params.id, req.user.id);
  return { success: true };
}));


export default router;
