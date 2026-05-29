import express from 'express';
import {
  getNotifications,
  getNotificationsByUser
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


export default router;
