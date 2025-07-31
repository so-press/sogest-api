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
  return await getNotifications();
}));

/**
 * @api {get} /notifications/:personneId Notifications d’un utilisateur via son ID de personne
 * @apiName GetNotificationsByPersonne
 * @apiGroup Notifications
 * @apiParam {Number} personneId ID de la personne
 * @apiSuccess {Object[]} notifications Notifications liées à cette personne
 */
router.get('/:personneId', handleResponse(async (req, res) => {
  const personneId = req.params.personneId;

  const personne = await getPersonne({ id: personneId });

  if (!personne || !personne.user_id) {
    res.status(404);
    throw new Error('Personne introuvable ou sans user_id associé');
  }

  const notifications = await getNotificationsByUser(personne.user_id);
  return notifications;
}));

export default router;
