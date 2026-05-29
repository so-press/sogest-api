import { db } from '../../db.js';

/**
 * Retourne toutes les notifications.
 * @returns {Promise<Object[]>}
 */
export async function getNotifications() {
  const query = db('notifications')
    .select('*')
    .orderBy([{ column: 'date', order: 'desc' }]);

  return (await query).map(formaterNotification);
}

/**
 * Retourne les notifications d'un utilisateur.
 * @param {number} user_id
 * @returns {Promise<Object[]>}
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
