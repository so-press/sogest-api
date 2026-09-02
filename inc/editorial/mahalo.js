import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const PARIS = 'Europe/Paris';

/**
 * Client de l'API Mahalo Grabber (https://utils.sopress.dev/mahalo/doc), qui
 * sert les calendriers de parution collectés sur Mahalo.
 *
 * Les données sont produites par un cron quotidien côté Mahalo Grabber : elles
 * ne bougent pas d'un appel à l'autre, d'où un cache mémoire à TTL long. Le
 * consommateur de ce module ne manipule jamais la notion de « titre » Mahalo :
 * tout est adressé par `support_id` sogest, via la table de transcodage.
 */

const TTL_MS = 60 * 60 * 1000;        // 1 h : le grabber tourne une fois par jour
const TTL_ERREUR_MS = 60 * 1000;      // 1 min : ne pas marteler l'API en panne
const TIMEOUT_MS = 8000;

const cache = new Map();

function baseUrl() {
  const base = process.env.MAHALO_URL;
  if (!base) throw new Error('MAHALO_URL manquant dans la configuration');
  return base.replace(/\/+$/, '');
}

/**
 * Appel authentifié à l'API Mahalo.
 * @param {string} path chemin absolu (ex. `/api/transco`)
 * @returns {Promise<{status: number, body: any}>}
 */
async function appel(path) {
  const token = process.env.MAHALO_TOKEN;
  if (!token) throw new Error('MAHALO_TOKEN manquant dans la configuration');

  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let body = null;
  try { body = await res.json(); } catch { /* réponse non JSON : body reste null */ }
  return { status: res.status, body };
}

/**
 * Appel mis en cache mémoire. Les erreurs sont mises en cache brièvement pour
 * éviter de marteler l'API pendant une indisponibilité.
 * @param {string} path
 * @returns {Promise<{status: number, body: any}>}
 */
async function appelCache(path) {
  const hit = cache.get(path);
  if (hit && hit.expire > Date.now()) return hit.valeur;

  let valeur;
  try {
    valeur = await appel(path);
  } catch (err) {
    valeur = { status: 0, body: null, erreur: '' + err };
  }

  const ok = valeur.status === 200;
  cache.set(path, { valeur, expire: Date.now() + (ok ? TTL_MS : TTL_ERREUR_MS) });
  return valeur;
}

/** Vide le cache mémoire (utile en test / après une collecte forcée). */
export function viderCacheMahalo() {
  cache.clear();
}

/**
 * Table de transcodage `support_id` sogest → référence du titre Mahalo.
 * Seules les correspondances arbitrées (`sogest_id` non nul) sont retenues.
 * @returns {Promise<Map<number, string>>}
 */
export async function getTransco() {
  const { status, body } = await appelCache('/api/transco');
  const map = new Map();
  if (status !== 200 || !body) return map;

  const entrees = body.transco ?? body.entrees ?? body.data ?? [];
  for (const e of Array.isArray(entrees) ? entrees : []) {
    if (e?.sogest_id == null || e?.ref == null) continue;
    // Premier arrivé gagne : la table est censée être 1-1, on ne devine pas.
    if (!map.has(Number(e.sogest_id))) map.set(Number(e.sogest_id), String(e.ref));
  }
  return map;
}

/**
 * Lignes de calendrier d'un support sogest, ou `[]` si le support n'a pas de
 * calendrier chez Mahalo (pas de transco, support « Date à date », collecte
 * absente…). Une absence de calendrier n'est jamais une erreur ici.
 * @param {number} supportId
 * @param {Map<number,string>} [transco] table déjà chargée, pour éviter un aller-retour
 * @returns {Promise<Object[]>}
 */
export async function getLignesCalendrier(supportId, transco = null) {
  const table = transco ?? await getTransco();
  const ref = table.get(Number(supportId));
  if (!ref) return [];

  const { status, body } = await appelCache(`/api/calendrier/${encodeURIComponent(ref)}`);
  if (status !== 200 || !Array.isArray(body?.rows)) return [];
  return body.rows;
}

/**
 * Date ISO UTC de Mahalo → date civile `YYYY-MM-DD` à Paris.
 * `2017-12-25T23:00:00Z` vaut le 26/12/2017 pour un lecteur français.
 * @param {string|null} iso
 * @returns {string|null}
 */
export function dateParis(iso) {
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d.tz(PARIS).format('YYYY-MM-DD') : null;
}
