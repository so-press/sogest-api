import { db } from '../db.js';


export async function getAbsences({ userId, year = null, month = null }) {
  if (isNaN(userId)) throw new Error('Invalid user ID');

  const query = db('absences')
    .where('user_id', userId);

  if (year !== null) {
    if (isNaN(year)) throw new Error('Invalid year');
    query.andWhereRaw('YEAR(date) = ?', [year]);
  }

  if (month !== null) {
    if (isNaN(month) || month < 1 || month > 12) throw new Error('Invalid month');
    query.andWhereRaw('MONTH(date) = ?', [month]);
  }

  return await query.orderBy('date', 'desc');
}