import dayjs from 'dayjs';
import { db } from '../../db.js';
import { saveToHistorique } from '../systeme/historique.js';
import { CRENEAUX, HEURE_FERMETURE, HEURE_OUVERTURE } from './endroits.js';

/** Champs modifiables d'une réservation (le rattachement `endroit_id` ne l'est pas). */
const EDITABLE = ['jour', 'debut', 'fin', 'objet', 'user_id'];

/** Colonnes de `reservations` exposées avec des heures déjà formatées en HH:mm. */
const COLS = [
  'id', 'endroit_id', 'endroit', 'objet', 'jour', 'user_id', 'user',
  'couleur1', 'couleur2', 'creation',
  db.raw('DATE_FORMAT(debut, "%H:%i") AS debut'),
  db.raw('DATE_FORMAT(fin, "%H:%i") AS fin'),
  db.raw('DATE_FORMAT(duree, "%H:%i") AS duree'),
];

/* ------------------------------------------------------------------ heures */

/**
 * Normalise une heure en `HH:mm` (`8:5`, `08:05:00`… sont acceptés).
 * @param {string} valeur
 * @returns {string|null} null si la valeur n'est pas une heure
 */
export function normaliserHeure(valeur) {
  if (!valeur) return null;
  const m = String(valeur).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Heure `HH:mm` → minutes depuis minuit. */
export function enMinutes(heure) {
  const [h, m] = heure.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes depuis minuit → `HH:mm`. */
export function enHeure(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Résout la plage horaire demandée : `fin` explicite, `duree` (`01:30`), ou
 * `creneau` (`matin`, `apres-midi`, `journee`).
 * @param {{debut?: string, fin?: string, duree?: string, creneau?: string}} data
 * @returns {{debut: string, fin: string}}
 * @throws {Error} `err.code` = `plage_invalide` / `creneau_inconnu`
 */
export function resoudrePlage({ debut, fin, duree, creneau } = {}) {
  if (creneau) {
    const c = CRENEAUX.find((x) => x.slug === creneau);
    if (!c) throw plageError('creneau_inconnu', `Créneau inconnu : ${creneau}`);
    return { debut: c.debut, fin: c.fin };
  }

  const d = normaliserHeure(debut);
  if (!d) throw plageError('plage_invalide', "L'heure de début est obligatoire (format HH:mm).");

  let f = normaliserHeure(fin);
  if (!f && duree) {
    const dur = normaliserHeure(duree);
    if (!dur) throw plageError('plage_invalide', 'La durée doit être au format HH:mm.');
    f = enHeure(enMinutes(d) + enMinutes(dur));
  }
  if (!f) throw plageError('plage_invalide', 'Il faut fournir `fin`, `duree` ou `creneau`.');

  if (enMinutes(f) <= enMinutes(d)) {
    throw plageError('plage_invalide', 'La fin doit être postérieure au début.');
  }
  if (enMinutes(d) < HEURE_OUVERTURE * 60 || enMinutes(f) > HEURE_FERMETURE * 60) {
    throw plageError(
      'plage_invalide',
      `Les réservations vont de ${String(HEURE_OUVERTURE).padStart(2, '0')}:00 à ${HEURE_FERMETURE}:00.`
    );
  }
  return { debut: d, fin: f };
}

function plageError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/* ----------------------------------------------------------------- couleurs */

/** CRC32 (même polynôme que PHP), pour retrouver les couleurs déjà en base. */
function crc32(str) {
  let crc = ~0;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) & 0xff;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

/**
 * Couleur de fond / couleur de texte d'un utilisateur, reprises telles quelles
 * de sogest (`couleursUser()`) pour que les plannings des deux applications
 * affichent les mêmes couleurs.
 * @param {number} userId
 * @returns {{main: string, contrast: 'black'|'white'}}
 */
export function couleursUser(userId) {
  // `dechex()` de PHP n'ajoute pas de zéro de tête : on reproduit sa troncature
  // telle quelle pour retrouver les couleurs déjà enregistrées par sogest.
  const main = '#' + crc32(String(userId)).toString(16).slice(0, 6).padEnd(6, '0');
  return { main, contrast: couleurContraste(main) };
}

function couleurContraste(hex) {
  const canal = (i) => Math.pow(parseInt(hex.substr(i, 2), 16) / 255, 2.2);
  const L = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  const ratio = Math.floor((L + 0.05) / 0.05);
  return ratio > 5 ? 'black' : 'white';
}

/* -------------------------------------------------------------- lectures */

function baseQuery() {
  return db('reservations').select(COLS).where('trash', '<>', 1);
}

/**
 * Liste des réservations, filtrée.
 * @param {{endroitId?: number, userId?: number, jour?: string, from?: string,
 *   to?: string, aVenir?: boolean, grouper?: boolean}} [options]
 *   `grouper` fusionne les créneaux consécutifs d'un même utilisateur (vue écran).
 * @returns {Promise<Object[]>}
 */
export async function listReservations({
  endroitId = null, userId = null, jour = null,
  from = null, to = null, aVenir = false, grouper = false,
} = {}) {
  const query = baseQuery().orderBy([
    { column: 'jour', order: 'asc' },
    { column: 'debut', order: 'asc' },
  ]);

  if (endroitId !== null) query.andWhere('endroit_id', endroitId);
  if (userId !== null) query.andWhere('user_id', userId);
  if (jour) query.andWhere('jour', jour);
  if (from) query.andWhere('jour', '>=', from);
  if (to) query.andWhere('jour', '<=', to);
  if (aVenir) query.andWhere('jour', '>=', dayjs().format('YYYY-MM-DD'));

  const rows = await query;
  return grouper ? grouperReservations(rows) : rows;
}

/**
 * Fusionne les réservations consécutives d'un même utilisateur sur un même
 * endroit (deux créneaux de 30 min collés deviennent une heure).
 * @param {Object[]} reservations triées par jour puis début
 * @returns {Object[]}
 */
export function grouperReservations(reservations) {
  const out = [];
  let courante = null;
  for (const r of reservations) {
    if (
      courante &&
      courante.user_id === r.user_id &&
      courante.endroit_id === r.endroit_id &&
      courante.jour === r.jour &&
      courante.fin === r.debut
    ) {
      courante = { ...courante, fin: r.fin, duree: enHeure(enMinutes(r.fin) - enMinutes(courante.debut)) };
      continue;
    }
    if (courante) out.push(courante);
    courante = { ...r };
  }
  if (courante) out.push(courante);
  return out;
}

/**
 * Récupère une réservation par son id (corbeille exclue).
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getReservation(id) {
  if (!id || isNaN(id)) throw new Error('Invalid reservation ID');
  return (await baseQuery().andWhere('id', id).first()) ?? null;
}

/**
 * Réservations qui chevauchent une plage sur un endroit.
 * @param {number} endroitId
 * @param {string} jour YYYY-MM-DD
 * @param {string} debut HH:mm
 * @param {string} fin HH:mm
 * @param {{exclureId?: number}} [options]
 * @returns {Promise<Object[]>}
 */
export async function findConflits(endroitId, jour, debut, fin, { exclureId = null } = {}) {
  const query = baseQuery()
    .andWhere('endroit_id', endroitId)
    .andWhere('jour', jour)
    // Chevauchement strict : deux créneaux qui se touchent ne se gênent pas.
    .andWhere('debut', '<', fin)
    .andWhere('fin', '>', debut);

  if (exclureId) query.andWhere('id', '<>', exclureId);
  return await query;
}

/**
 * Indique si un endroit est libre à un instant donné (défaut : maintenant).
 * @param {number} endroitId
 * @param {string} [jour]
 * @param {string} [heure]
 * @returns {Promise<boolean>}
 */
export async function endroitDisponible(endroitId, jour = null, heure = null) {
  const j = jour || dayjs().format('YYYY-MM-DD');
  const h = normaliserHeure(heure) || dayjs().format('HH:mm');
  const occupee = await baseQuery()
    .andWhere('endroit_id', endroitId)
    .andWhere('jour', j)
    .andWhere('debut', '<=', h)
    .andWhere('fin', '>', h)
    .first();
  return !occupee;
}

/**
 * Disponibilité immédiate d'une liste d'endroits, en une seule requête.
 * @param {number[]} endroitIds
 * @returns {Promise<Map<number, boolean>>} id → libre ?
 */
export async function disponibilites(endroitIds) {
  const map = new Map(endroitIds.map((id) => [Number(id), true]));
  if (!endroitIds.length) return map;

  const maintenant = dayjs().format('HH:mm');
  const rows = await db('reservations')
    .select('endroit_id')
    .where('trash', '<>', 1)
    .whereIn('endroit_id', endroitIds)
    .andWhere('jour', dayjs().format('YYYY-MM-DD'))
    .andWhere('debut', '<=', maintenant)
    .andWhere('fin', '>', maintenant);

  for (const row of rows) map.set(Number(row.endroit_id), false);
  return map;
}

/* -------------------------------------------------------------- écritures */

/** Champs dénormalisés que sogest attend dans la ligne (libellés + couleurs). */
async function enrichir({ endroit_id, user_id, debut, fin }) {
  const endroit = await db('endroits').select('libelle').where({ id: endroit_id }).first();
  const user = await db('users').select('nom').where({ id: user_id }).first();
  const couleurs = couleursUser(user_id);
  return {
    endroit: endroit?.libelle || '',
    user: user?.nom || '',
    duree: enHeure(enMinutes(fin) - enMinutes(debut)),
    couleur1: couleurs.main,
    couleur2: couleurs.contrast,
  };
}

/**
 * Pose une réservation. La plage doit déjà être résolue (cf. {@link resoudrePlage})
 * et libre (cf. {@link findConflits}) : la vérification d'usage appartient à la route.
 * @param {{endroit_id: number, user_id: number, jour: string, debut: string, fin: string, objet?: string}} data
 * @returns {Promise<Object>}
 */
export async function createReservation({ endroit_id, user_id, jour, debut, fin, objet = '' }) {
  if (!endroit_id || isNaN(endroit_id)) throw new Error('Invalid endroit ID');
  if (!user_id || isNaN(user_id)) throw new Error('Invalid user ID');

  const [id] = await db('reservations').insert({
    endroit_id,
    user_id,
    jour,
    debut,
    fin,
    objet: objet || '',
    trash: 0,
    ...(await enrichir({ endroit_id, user_id, debut, fin })),
  });

  return await getReservation(id);
}

/**
 * Modifie une réservation (jour, plage, objet, titulaire). L'état précédent est
 * versionné dans `historique`.
 * @param {number} id
 * @param {Object} data
 * @param {{auteur?: Object|null}} [options] Auteur tracé dans l'historique
 *   (utile sous jeton applicatif, où la requête n'a pas d'utilisateur).
 * @returns {Promise<Object|null>}
 */
export async function updateReservation(id, data, { auteur = undefined } = {}) {
  const avant = await getReservation(id);
  if (!avant) return null;

  const update = {};
  for (const field of EDITABLE) {
    if (data[field] !== undefined) update[field] = data[field];
  }
  if (!Object.keys(update).length) return avant;

  const debut = update.debut ?? avant.debut;
  const fin = update.fin ?? avant.fin;
  const user_id = update.user_id ?? avant.user_id;
  Object.assign(update, await enrichir({ endroit_id: avant.endroit_id, user_id, debut, fin }));

  await saveToHistorique('reservations', id, auteur);
  await db('reservations').where({ id }).update(update);
  return await getReservation(id);
}

/**
 * Annule une réservation (corbeille, comme sogest : rien n'est effacé).
 * @param {number} id
 * @param {{auteur?: Object|null}} [options]
 * @returns {Promise<boolean>}
 */
export async function deleteReservation(id, { auteur = undefined } = {}) {
  await saveToHistorique('reservations', id, auteur);
  const count = await db('reservations').where({ id }).update({ trash: 1 });
  return count > 0;
}
