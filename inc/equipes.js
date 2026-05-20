import { db } from '../db.js';
import { slugify } from './utils.js';

function buildSlug(row) {
  const base = slugify(row.libelle || '') || `equipe-${row.id}`;
  return base;
}

function withUniqueSlugs(rows) {
  const counts = new Map();
  for (const row of rows) {
    const base = buildSlug(row);
    counts.set(base, (counts.get(base) || 0) + 1);
  }

  const seen = new Map();
  return rows.map((row) => {
    const base = buildSlug(row);
    let slug = base;
    if (counts.get(base) > 1) {
      slug = `${base}-${row.id}`;
    }
    seen.set(base, (seen.get(base) || 0) + 1);
    return { ...row, slug };
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

  return withUniqueSlugs(await query);
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
    return { ...row, slug: buildSlug(row) };
  }

  const list = await getEquipes({ all: true });
  return list.find((r) => r.slug === idOrSlug) ?? null;
}
