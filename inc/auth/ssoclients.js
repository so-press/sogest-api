import bcrypt from 'bcrypt';
import { db } from '../../db.js';
import { getSupport } from '../editorial/supports.js';

const PUBLIC_FIELDS = [
  'ssoclients.id', 'ssoclients.client_id', 'ssoclients.title', 'ssoclients.subtitle', 'ssoclients.base_url',
  'ssoclients.account_recovery_url',
  'ssoclients.qr_login', 'ssoclients.login_captcha', 'ssoclients.two_step_login',
  'ssoclients.redirect_uris', 'ssoclients.urls', 'ssoclients.actif', 'ssoclients.payload_handler',
  'ssoclients.email', 'ssoclients.color', 'ssoclients.background',
  'ssoclients.main_color', 'ssoclients.main_color_alt',
  'ssoclients.support_id', 'ssoclients.client_secret', 'ssoclients.auth_sources',
  'ssoclients.variantes',
  // Config Sign in with Google (source d'auth `google`) — consommée par le SSO.
  // L'entité accordée = slug du support rattaché (pas de colonne dédiée).
  'ssoclients.google_oauth_client_id', 'ssoclients.google_publication_id',
  'ssoclients.google_product_id',
  // support_id est utilisé pour charger le support, puis retiré de la réponse
];

async function formatSsoclient(row) {
  if (!row) return row;

  for (const field of ['redirect_uris', 'urls', 'auth_sources', 'variantes']) {
    if (typeof row[field] === 'string') {
      try { row[field] = JSON.parse(row[field]); } catch { row[field] = []; }
    }
  }

  for (const field of ['qr_login', 'login_captcha', 'two_step_login']) {
    row[field] = Boolean(row[field]);
  }

  // `main_client_id` = client_id réel du client (parent). Posé ici, avant toute
  // surcharge par une variante : quand la réponse est « projetée » sur une
  // variante (client_id remplacé par celui de la variante), main_client_id
  // continue d'exposer le client_id d'origine.
  row.main_client_id = row.client_id;

  const secret = row.client_secret;
  delete row.client_secret;
  row.client_secret_hash = secret ? await bcrypt.hash(secret, 10) : null;

  const supportId = row.support_id;
  delete row.support_id;
  row.support = supportId ? await getSupport(supportId) : null;

  return row;
}

/**
 * Liste des SSO clients non corbeille, triés par client_id.
 * @returns {Promise<Object[]>}
 */
export async function getSsoclients() {
  const rows = await db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1)
    .orderBy('ssoclients.client_id', 'asc');

  return Promise.all(rows.map(formatSsoclient));
}


/**
 * Récupère un SSO client par son `id` (numérique) ou son `client_id`.
 *
 * Fallback : si la chaîne n'est pas numérique et qu'aucun ssoclient n'a ce
 * `client_id`, on parcourt les variantes (JSON `[{clientId, clientName}, …]`)
 * de chaque ssoclient et on renvoie le parent dont une variante matche sur
 * `clientId`. Dans ce cas, `client_id`/`subtitle` sont remplacés par ceux de la
 * variante, mais `main_client_id` garde le `client_id` réel du parent. Volume
 * faible côté base → boucle JS acceptable.
 *
 * @param {number|string} idOrClientId
 * @returns {Promise<Object|null>}
 */
export async function getSsoclient(idOrClientId) {
  const isNumeric = /^\d+$/.test(String(idOrClientId));

  const direct = await db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1)
    .andWhere(isNumeric ? 'ssoclients.id' : 'ssoclients.client_id', idOrClientId)
    .first();

  if (direct) return formatSsoclient(direct);
console.warn(`SSO client not found by ${isNumeric ? 'id' : 'client_id'}:`, idOrClientId);
  // Recherche par id numérique : pas de fallback variantes (les variantes
  // n'ont pas d'id propre).
  if (isNumeric) return null;

  const all = await db('ssoclients')
    .select(PUBLIC_FIELDS)
    .where('ssoclients.trash', '<>', 1);

  for (const row of all) {
    let variantes = row.variantes;
    if (typeof variantes === 'string') {
      try { variantes = JSON.parse(variantes); } catch { variantes = []; }
    }
    if (!Array.isArray(variantes)) continue;
    const match = variantes.find(v => v && v.clientId === idOrClientId);
    if (match) {
      const formatted = await formatSsoclient(row);
      formatted.client_id = match.clientId;
      formatted.subtitle = match.clientName;
      formatted.base_url = match.url;
      delete formatted.variantes;
      return formatted;
    }
  }

  return null;
}
