import { db } from '../../db.js';
import { md5, slugify } from '../core/utils.js';
import { resolveLogoUrls } from '../editorial/supports.js';
import { sogestUrl } from '../core/sogest.js';
import { getUsers } from './users.js';

const SOPRESS_SUPPORT_NAME = 'SO PRESS';
let sopressIdPromise = null;

function getSopressSupportId() {
  if (!sopressIdPromise) {
    sopressIdPromise = db('supports')
      .select('id')
      .where('nom', SOPRESS_SUPPORT_NAME)
      .where('trash', '<>', 1)
      .first()
      .then((row) => row?.id ?? null)
      .catch(() => null);
  }
  return sopressIdPromise;
}

function hasLogo(logos) {
  return !!(logos && (logos.logo || logos.logo_svg));
}

async function resolveLogoUrlsWithFallback(supportId) {
  if (supportId > 0) {
    const logos = await resolveLogoUrls(supportId);
    if (hasLogo(logos)) return logos;
  }
  const fallbackId = await getSopressSupportId();
  if (fallbackId && fallbackId !== supportId) {
    return resolveLogoUrls(fallbackId);
  }
  return { logo: null, logo_svg: null };
}

function buildSlug(row) {
  const base = slugify(row.libelle || '') || `equipe-${row.id}`;
  return base;
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Ancres de teinte réparties sur les couleurs "sûres" : on exclut les rouges,
// roses et magentas/violets qui dominent visuellement en pastel
// (orange, ambre, jaune, citron, vert clair, vert, émeraude, teal, cyan, bleu ciel, bleu, indigo)
const HUE_ANCHORS = [25, 40, 55, 75, 100, 130, 160, 180, 200, 215, 235, 255];

// Léger ajustement de luminosité par teinte pour égaliser le rendu pastel
// (jaune/cyan paraissent plus clairs, bleu/violet plus sombres)
function lightnessFor(hue) {
  if (hue >= 40 && hue <= 75) return 76;   // jaunes
  if (hue >= 75 && hue <= 180) return 80;  // verts/cyans
  if (hue >= 200 && hue <= 280) return 85; // bleus
  return 82;                                // rouges, oranges, violets, magentas
}

function buildCouleur(row) {
  const seed = md5(`${row.id}|${row.libelle}|${row.support_id}|${row.support}`);

  // Sélection d'une ancre parmi 12 → distribution uniforme garantie
  const anchor = HUE_ANCHORS[parseInt(seed.slice(0, 8), 16) % HUE_ANCHORS.length];
  // Petit jitter ±10° pour éviter des couleurs identiques d'un bucket à l'autre
  const jitter = (parseInt(seed.slice(8, 10), 16) % 21) - 10;
  const hue = (anchor + jitter + 360) % 360;

  const sat = 65 + (parseInt(seed.slice(10, 12), 16) % 16);    // 65-80 %
  const light = lightnessFor(hue) + (parseInt(seed.slice(12, 14), 16) % 5) - 2; // ±2

  return hslToHex(hue, sat, light);
}

async function supportLogosMap(supportIds) {
  const unique = [...new Set(supportIds.filter((id) => id > 0))];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await resolveLogoUrls(id)])
  );
  return new Map(entries);
}

function persistCouleur(id, couleur) {
  db('equipes')
    .where('id', id)
    .update({ couleur })
    .catch((err) => console.error(`Failed to persist couleur for equipe ${id}:`, err.message));
}

function resolveCouleur(row) {
  if (row.couleur) return row.couleur;
  const couleur = buildCouleur(row);
  persistCouleur(row.id, couleur);
  return couleur;
}

async function decorate(row) {
  const logos = await resolveLogoUrlsWithFallback(row.support_id);
  return {
    ...row,
    slug: buildSlug(row),
    couleur: resolveCouleur(row),
    support_logo: logos.logo,
    support_logo_svg: logos.logo_svg,
    calendrier_absences: sogestUrl('absences.php', { equipe: row.id }),
  };
}

async function decorateList(rows) {
  const counts = new Map();
  for (const row of rows) {
    const base = buildSlug(row);
    counts.set(base, (counts.get(base) || 0) + 1);
  }

  const logoMap = await supportLogosMap(rows.map((r) => r.support_id));
  const fallbackId = await getSopressSupportId();
  const fallbackLogos = fallbackId
    ? logoMap.get(fallbackId) ?? await resolveLogoUrls(fallbackId)
    : { logo: null, logo_svg: null };

  return rows.map((row) => {
    const base = buildSlug(row);
    const slug = counts.get(base) > 1 ? `${base}-${row.id}` : base;
    const own = row.support_id > 0 ? logoMap.get(row.support_id) : null;
    const logos = hasLogo(own) ? own : fallbackLogos;
    return {
      ...row,
      slug,
      couleur: resolveCouleur(row),
      support_logo: logos.logo,
      support_logo_svg: logos.logo_svg,
      calendrier_absences: sogestUrl('absences.php', { equipe: row.id }),
    };
  });
}

/**
 * Liste des équipes non corbeille (visibles par défaut).
 * @param {{all?: boolean}} [options] all=true inclut aussi les équipes non visibles
 * @returns {Promise<Object[]>}
 */
export async function getEquipes({ all = false } = {}) {
  const query = db('equipes')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy('libelle', 'asc');

  if (!all) {
    query.andWhere('visible', 1);
  }

  return decorateList(await query);
}

/**
 * Liste des équipes auxquelles un utilisateur est rattaché (avec son `role`).
 * @param {number} userId
 * @returns {Promise<Object[]>}
 */
export async function getEquipesByUserId(userId) {
  if (isNaN(userId)) throw new Error('Invalid user ID');
  const rows = await db('equipes')
    .select('equipes.*', 'lien_equipe_user.role')
    .join('lien_equipe_user', 'lien_equipe_user.equipe_id', 'equipes.id')
    .where('lien_equipe_user.user_id', userId)
    .andWhere('equipes.trash', '<>', 1)
    .andWhere('equipes.visible', 1)
    .orderBy('equipes.libelle', 'asc');

  return decorateList(rows);
}

/**
 * Récupère une équipe par son id numérique ou son slug.
 * @param {number|string} idOrSlug
 * @returns {Promise<Object|null>}
 */
export async function getEquipe(idOrSlug) {
  if (/^\d+$/.test(String(idOrSlug))) {
    const row = await db('equipes')
      .select('*')
      .where('trash', '<>', 1)
      .andWhere('id', idOrSlug)
      .first();
    if (!row) return null;
    return await decorate(row);
  }

  return getEquipeBySlug(idOrSlug);
}

/**
 * Récupère une équipe par son slug.
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
export async function getEquipeBySlug(slug) {
  const list = await getEquipes({ all: true });
  return list.find((r) => r.slug === slug) ?? null;
}

/**
 * Indique si un utilisateur est membre d'une équipe (table `lien_equipe_user`).
 * @param {number} userId
 * @param {number} equipeId
 * @returns {Promise<boolean>}
 */
export async function isUserInEquipe(userId, equipeId) {
  if (!userId || isNaN(userId) || !equipeId || isNaN(equipeId)) return false;
  const lien = await db('lien_equipe_user')
    .where({ user_id: userId, equipe_id: equipeId })
    .first();
  return !!lien;
}

/**
 * Membres d'une équipe : utilisateurs actifs rattachés à l'équipe, au même
 * format que `GET /users` (avatar, links…), enrichis de leur `role` et de la
 * date d'entrée dans l'équipe (`membre_depuis`).
 * @param {number} equipeId
 * @returns {Promise<Object[]>}
 */
export async function getMembresEquipe(equipeId) {
  if (!equipeId || isNaN(equipeId)) throw new Error('Invalid equipe ID');

  const liens = await db('lien_equipe_user')
    .select('user_id', 'role', 'creation')
    .where('equipe_id', equipeId);

  if (!liens.length) return [];

  // getUsers() filtre déjà les comptes en corbeille / inactifs et applique
  // formatUser() : on se contente de restreindre au périmètre de l'équipe.
  const ids = liens.map((l) => l.user_id);
  const users = await getUsers({
    clause: { raw: `u.id IN (${ids.map(() => '?').join(',')})`, params: ids },
  });

  const lienByUser = new Map(liens.map((l) => [l.user_id, l]));
  return users.map((u) => ({
    ...u,
    role: lienByUser.get(u.id)?.role || null,
    membre_depuis: lienByUser.get(u.id)?.creation ?? null,
  }));
}

/**
 * Rattachement brut d'un utilisateur à une équipe (ligne `lien_equipe_user`),
 * sans décoration.
 * @param {number} equipeId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getLienEquipeUser(equipeId, userId) {
  if (!equipeId || isNaN(equipeId) || !userId || isNaN(userId)) return null;
  return (await db('lien_equipe_user')
    .where({ equipe_id: equipeId, user_id: userId })
    .first()) ?? null;
}

/**
 * Trace un ajout / retrait de membre dans la table `historique`.
 *
 * `lien_equipe_user` n'a pas de clé primaire : on ne peut pas utiliser
 * `saveToHistorique()` (qui historise une ligne par son `id`). On enregistre
 * donc l'évènement lui-même, indexé sur l'équipe (`cle` = `equipe_id`).
 *
 * @param {'ajout'|'retrait'} action
 * @param {number} equipeId
 * @param {number} userId
 * @param {string|null} role
 * @param {{id?: number, nomComplet?: string}|null} auteur Utilisateur à l'origine
 *   du changement ; `null` pour un appel par jeton applicatif non identifié.
 */
async function logMembreEquipe(action, equipeId, userId, role, auteur) {
  await db('historique').insert({
    table: 'lien_equipe_user',
    cle: equipeId,
    donnee: JSON.stringify({ action, equipe_id: equipeId, user_id: userId, role: role || null }),
    user: auteur?.nomComplet || 'api',
    user_id: auteur?.id || 0,
  });
}

/**
 * Ajoute un utilisateur à une équipe.
 *
 * @param {number} equipeId
 * @param {number} userId
 * @param {{role?: string|null, auteur?: Object|null}} [options]
 * @returns {Promise<Object>} Le membre au format `getMembresEquipe()`
 * @throws {Error} `err.code = 'membre_existant'` si le rattachement existe déjà
 */
export async function addMembreEquipe(equipeId, userId, { role = null, auteur = null } = {}) {
  if (!equipeId || isNaN(equipeId)) throw new Error('Invalid equipe ID');
  if (!userId || isNaN(userId)) throw new Error('Invalid user ID');

  if (await getLienEquipeUser(equipeId, userId)) {
    const err = new Error('Membre déjà rattaché à cette équipe');
    err.code = 'membre_existant';
    throw err;
  }

  // `role` est NOT NULL en base : chaîne vide plutôt que NULL, comme sogest.
  await db('lien_equipe_user').insert({
    equipe_id: equipeId,
    user_id: userId,
    role: role || '',
  });

  await logMembreEquipe('ajout', equipeId, userId, role, auteur);

  const membres = await getMembresEquipe(equipeId);
  return membres.find((m) => m.id === Number(userId)) ?? null;
}

/**
 * Retire un utilisateur d'une équipe (le compte utilisateur n'est pas touché).
 *
 * @param {number} equipeId
 * @param {number} userId
 * @param {{auteur?: Object|null}} [options]
 * @returns {Promise<boolean>} false si la personne n'était pas membre
 */
export async function removeMembreEquipe(equipeId, userId, { auteur = null } = {}) {
  if (!equipeId || isNaN(equipeId)) throw new Error('Invalid equipe ID');
  if (!userId || isNaN(userId)) throw new Error('Invalid user ID');

  const lien = await getLienEquipeUser(equipeId, userId);
  if (!lien) return false;

  await db('lien_equipe_user').where({ equipe_id: equipeId, user_id: userId }).delete();
  await logMembreEquipe('retrait', equipeId, userId, lien.role || null, auteur);

  return true;
}
