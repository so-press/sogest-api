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
 * Marque une notification comme lue (et vue) pour son propriétaire — même
 * sémantique que l'appli web legacy (`class.notifs.php::passerLue`). Scopée
 * par `user_id` pour qu'un utilisateur ne puisse pas marquer la notif d'un
 * autre.
 * @param {number} id
 * @param {number} user_id
 * @returns {Promise<number>} nombre de lignes modifiées
 */
export async function markNotificationRead(id, user_id) {
  return db('notifications').where({ id, user_id }).update({ lue: 1, vue: 1 });
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
