import { db } from '../db.js';
import { md5, slugify } from './utils.js';
import { resolveLogoUrls } from './supports.js';

const SOPRESS_SUPPORT_ID = 36;

function effectiveSupportId(row) {
  return row.support_id > 0 ? row.support_id : SOPRESS_SUPPORT_ID;
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

function buildCouleur(row) {
  const seed = md5(`${row.id}|${row.libelle}|${row.support_id}|${row.support}`);
  const hue = parseInt(seed.slice(0, 8), 16) % 360;
  const sat = 60 + (parseInt(seed.slice(8, 10), 16) % 16);   // 60-75 %
  const light = 80 + (parseInt(seed.slice(10, 12), 16) % 8); // 80-87 %
  return hslToHex(hue, sat, light);
}

async function supportLogosFor(supportIds) {
  const unique = [...new Set(supportIds)];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await resolveLogoUrls(id)])
  );
  return new Map(entries);
}

async function decorate(row) {
  const logos = await resolveLogoUrls(effectiveSupportId(row));
  return {
    ...row,
    slug: buildSlug(row),
    couleur: buildCouleur(row),
    support_logo: logos.logo,
    support_logo_svg: logos.logo_svg,
  };
}

async function decorateList(rows) {
  const counts = new Map();
  for (const row of rows) {
    const base = buildSlug(row);
    counts.set(base, (counts.get(base) || 0) + 1);
  }

  const logoMap = await supportLogosFor(rows.map(effectiveSupportId));

  return rows.map((row) => {
    const base = buildSlug(row);
    const slug = counts.get(base) > 1 ? `${base}-${row.id}` : base;
    const logos = logoMap.get(effectiveSupportId(row)) ?? { logo: null, logo_svg: null };
    return {
      ...row,
      slug,
      couleur: buildCouleur(row),
      support_logo: logos.logo,
      support_logo_svg: logos.logo_svg,
    };
  });
}

/**
 * @api {function} getEquipes Retourne la liste des équipes (non corbeille)
 * @apiName GetEquipesFunc
 * @apiGroup Equipes
 * @apiParam {Object} [options]
 * @apiParam {Boolean} [options.all=false] Si vrai, inclut aussi les équipes non visibles
 * @apiSuccess {Object[]} equipes Liste des équipes
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
 * @api {function} getEquipe Retourne une équipe par son id ou son slug
 * @apiName GetEquipeFunc
 * @apiGroup Equipes
 * @apiParam {Number|String} idOrSlug Identifiant numérique ou slug
 * @apiSuccess {Object} equipe Données de l'équipe
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
 * @api {function} getEquipeBySlug Retourne une équipe par son slug
 * @apiName GetEquipeBySlugFunc
 * @apiGroup Equipes
 * @apiParam {String} slug Slug de l'équipe
 * @apiSuccess {Object} equipe Données de l'équipe
 */
export async function getEquipeBySlug(slug) {
  const list = await getEquipes({ all: true });
  return list.find((r) => r.slug === slug) ?? null;
}
