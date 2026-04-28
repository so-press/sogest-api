import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { getSupport } from './supports.js';

const PUBLIC_FIELDS = [
  'ssoclients.id', 'ssoclients.client_id', 'ssoclients.title', 'ssoclients.slug', 'ssoclients.base_url',
  'ssoclients.account_recovery_url',
  'ssoclients.redirect_uris', 'ssoclients.urls', 'ssoclients.actif', 'ssoclients.payload_handler',
  'ssoclients.email', 'ssoclients.color', 'ssoclients.background',
  'ssoclients.main_color', 'ssoclients.main_color_alt',
  'ssoclients.support_id', 'ssoclients.client_secret', 'ssoclients.auth_sources',
  // support_id est utilisé pour charger le support, puis retiré de la réponse
];

async function formatSsoclient(row) {
  if (!row) return row;

  for (const field of ['redirect_uris', 'urls', 'auth_sources']) {
    if (typeof row[field] === 'string') {
      try { row[field] = JSON.parse(row[field]); } catch { row[field] = []; }
    }
  }

  const secret = row.client_secret;
  delete row.client_secret;
  row.client_secret_hash = secret ? await bcrypt.hash(secret, 10) : null;

  const supportId = row.support_id;
  delete row.support_id;
  row.support = supportId ? await getSupport(supportId) : null;

  return row;
}

/**
 * @api {function} getSsoclients Retourne la liste des SSO clients actifs
 * @apiName GetSsoclientsFunc
 * @apiGroup Ssoclients
 * @apiSuccess {Object[]} ssoclients Liste des clients SSO
 */
export async function getSsoclients() {
  const rows = await db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1)
    .orderBy('ssoclients.client_id', 'asc');

  return Promise.all(rows.map(formatSsoclient));
}


/**
 * @api {function} getSsoclient Retourne un SSO client par son id ou client_id
 * @apiName GetSsoclientFunc
 * @apiGroup Ssoclients
 * @apiParam {Number|String} idOrClientId Identifiant numérique ou client_id
 * @apiSuccess {Object} ssoclient Données du client SSO
 */
export async function getSsoclientBySlug(slug) {
  const row = await db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1)
    .andWhere('ssoclients.slug', slug)
    .first() ?? null;

  return formatSsoclient(row);
}

export async function getSsoclient(idOrClientId) {
  const query = db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1);

  if (/^\d+$/.test(String(idOrClientId))) {
    query.andWhere('ssoclients.id', idOrClientId);
  } else {
    query.andWhere('ssoclients.client_id', idOrClientId);
  }

  return formatSsoclient(await query.first() ?? null);
}
