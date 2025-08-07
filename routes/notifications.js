import express from 'express';
import {
  getNotifications,
  getNotificationsByUser
} from '../inc/notifications.js';
import { getPersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/notifications';

/**
 * @api {get} /notifications Liste complète des notifications
 * @apiName GetAllNotifications
 * @apiGroup Notifications
 * @apiSuccess {Object[]} notifications Toutes les notifications
 */
router.get('/', handleResponse(async () => {
  return await getNotificationsByUser(req.user.id);
}));

export default router;
