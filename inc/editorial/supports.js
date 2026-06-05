import sharp from 'sharp';
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

/**
<<<<<<< HEAD
 * Résout un id/slug de support vers l'URL SOGEST de son fichier logo brut,
 * sans charger le support complet (pas de HEAD sur les variantes).
 * @param {number|string} idOrSlug
 * @param {'svg'|'png'} format
 * @returns {Promise<string|null>} URL du fichier, ou null si support introuvable
 */
async function getSupportLogoUrl(idOrSlug, format) {
  const query = db('supports')
    .select('id')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (/^\d+$/.test(String(idOrSlug))) {
    query.andWhere('id', idOrSlug);
  } else {
    query.andWhere('slug', idOrSlug);
  }

  const row = await query.first();
  if (!row) return null;

  const base = `uploads/files/supports/${row.id}/`;
  return sogestUrl(base + (format === 'svg' ? 'logo-svg.svg' : 'logo.png'));
}

/** Convertit une couleur hexa (3 ou 6 chiffres, sans `#`) en {r,g,b}. */
function hexToRgb(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Réécrit les couleurs de remplissage d'un SVG vers une couleur unique.
 * Les `fill="none"` et `fill:none` (formes transparentes) ainsi que les
 * références `url(#…)` (dégradés/motifs) sont préservés. Le `<svg>` racine
 * reçoit un `fill` pour que les formes sans fill explicite héritent la couleur.
 * @param {string} svg
 * @param {string} hex couleur hexa sans `#`
 * @returns {string}
 */
function recolorSvg(svg, hex) {
  const color = `#${hex}`;
  let out = svg
    .replace(/fill\s*=\s*"(?!none|url\()[^"]*"/gi, `fill="${color}"`)
    .replace(/fill\s*=\s*'(?!none|url\()[^']*'/gi, `fill='${color}'`)
    .replace(/fill\s*:\s*(?!none|url\()[^;"'}]+/gi, `fill:${color}`);

  if (!/<svg[^>]*\bfill\s*=/i.test(out)) {
    out = out.replace(/<svg\b/i, `<svg fill="${color}"`);
  }
  return out;
}

/**
 * Applique un aplat de couleur sur un PNG façon « Color Overlay » Photoshop
 * (opacité 100 %, mode normal) : chaque pixel non transparent prend la couleur
 * demandée, le canal alpha d'origine est conservé.
 * @param {Buffer} buffer PNG source
 * @param {string} hex couleur hexa sans `#`
 * @returns {Promise<Buffer>} PNG recoloré
 */
async function tintPng(buffer, hex) {
  const { r, g, b } = hexToRgb(hex);
  const src = sharp(buffer).ensureAlpha();
  const { width, height } = await src.metadata();
  const alpha = await src.clone().extractChannel('alpha').raw().toBuffer();

  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Récupère le logo d'un support et, si une couleur est fournie, le recolore.
 * SVG → réécriture du `fill` ; PNG → aplat de couleur conservant la transparence.
 * @param {number|string} idOrSlug id numérique ou slug du support
 * @param {'svg'|'png'} format
 * @param {string} [color] couleur hexa sans `#` (3 ou 6 chiffres)
 * @returns {Promise<{contentType: string, body: string|Buffer}|null>} null si introuvable
 */
export async function renderSupportLogo(idOrSlug, format, color) {
  const url = await getSupportLogoUrl(idOrSlug, format);
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;

  if (format === 'svg') {
    let svg = await res.text();
    if (color) svg = recolorSvg(svg, color);
    return { contentType: 'image/svg+xml; charset=utf-8', body: svg };
  }

  let buf = Buffer.from(await res.arrayBuffer());
  if (color) buf = await tintPng(buf, color);
  return { contentType: 'image/png', body: buf };
=======
 * Récupère un support par son slug uniquement (jamais par id numérique).
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
export async function getSupportBySlug(slug) {
  const row = await db('supports')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .andWhere('slug', slug)
    .first();

  return formatSupport(row ?? null);
>>>>>>> 4c21ac6530c9aaf89b88d0fe4eba8400cca2160c
}
