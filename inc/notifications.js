/**
 * @namespace Notifications
 */
import { db } from '../db.js';

/**
 * @api {function} getNotifications Retourne toutes les notifications
 * @apiName GetNotificationsFunc
 * @apiGroup Notifications
 *
 * @apiSuccess {Object[]} notifications Liste des notifications formatées
 */
export async function getNotifications() {
  const query = db('notifications')
    .select('*')
    .orderBy([{ column: 'date', order: 'desc' }]);

  return (await query).map(formaterNotification);
}

/**
 * @api {function} getNotificationsByUser Retourne les notifications d’un utilisateur
 * @apiName GetNotificationsByUserFunc
 * @apiGroup Notifications
 *
 * @apiParam {Number} user_id ID de l'utilisateur
 * @apiSuccess {Object[]} notifications Notifications liées à l'utilisateur
 */
export async function getNotificationsByUser(user_id) {
  const query = db('notifications')
    .select('*')
    .where('user_id', user_id)
    .orderBy([{ column: 'date', order: 'desc' }]);

  return (await query).map(formaterNotification);
}

/**
 * Formate une notification (ex : conversion de date)
 *
 * @param {Object} notification Données brutes issues de la BDD
 * @returns {Object} Notification formatée
 */
function formaterNotification(notification) {
  if (!notification) return;
  notification.date = new Date(notification.date);
  return notification;
}
