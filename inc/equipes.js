import { db } from '../db.js';
import { md5, slugify } from './utils.js';
import { resolveLogoUrls } from './supports.js';
import { sogestUrl } from './sogest.js';

const SOPRESS_SUPPORT_NAME = 'SO PRESS';
let sopressIdPromise = null;

function getSopressSupportId() {
  if (!sopressIdPromise) {
    sopressIdPromise = db('supports')
      .select('id')
      .where('nom', SOPRESS_SUPPORT_NAME)
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
