import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';


async function urlExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveLogoUrls(id) {
  const base = `uploads/files/supports/${id}/`;
  const pngUrl = sogestUrl(base + 'logo.png');
  const jpgUrl = sogestUrl(base + 'logo.jpg');
  const svgUrl = sogestUrl(base + 'logo-svg.svg');

  const [pngExists, jpgExists, svgExists] = await Promise.all([
    urlExists(pngUrl),
    urlExists(jpgUrl),
    urlExists(svgUrl),
  ]);

  return {
    logo: pngExists ? pngUrl : jpgExists ? jpgUrl : null,
    logo_svg: svgExists ? svgUrl : null,
  };
}

async function formatSupport(row) {
  if (!row) return row;

  const out = { ...row };

  if (typeof out.liens === 'string') {
    try { out.liens = JSON.parse(out.liens); } catch { out.liens = []; }
  }

  if (typeof out.contenus === 'string') {
    out.contenus = out.contenus ? out.contenus.split(',').map(Number).filter(Boolean) : [];
  }

  Object.assign(out, await resolveLogoUrls(out.id));

  return out;
}

/**
 * Liste des supports actifs (non corbeille, non indisponibles).
 * @returns {Promise<Object[]>}
 */
export async function getSupports() {
  const rows = await db('supports')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .orderBy([{ column: 'ordre', order: 'desc' }, { column: 'nom', order: 'asc' }]);

  return Promise.all(rows.map(formatSupport));
}

/**
 * Récupère un support par son id numérique ou son slug.
 * @param {number|string} idOrSlug
 * @returns {Promise<Object|null>}
 */
export async function getSupport(idOrSlug) {
  const query = db('supports')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (/^\d+$/.test(String(idOrSlug))) {
    query.andWhere('id', idOrSlug);
  } else {
    query.andWhere('slug', idOrSlug);
  }

  return formatSupport(await query.first() ?? null);
}
