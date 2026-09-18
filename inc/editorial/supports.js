import sharp from 'sharp';
import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { urlExists, slugify } from '../core/utils.js';
import { getDerniereActivitePourSupport, rafraichirActivitesDuSupport } from './activites.js';
import { saveToHistorique } from '../systeme/historique.js';

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

/**
 * Pages d'abonnements du support (`[{ url, titre }]`, titre éventuellement
 * vide), saisies dans l'onglet « Abonnements » de sogest. À défaut, repli sur
 * le premier des liens à partager libellé « boutique », exposé sous le titre
 * « Boutique » : les supports qui n'ont pas encore été renseignés gardent ainsi
 * une page où s'abonner.
 */
function pagesAbonnements(stockees, liens) {
  let pages = [];
  if (typeof stockees === 'string' && stockees) {
    try { pages = JSON.parse(stockees); } catch { pages = []; }
  }
  pages = (Array.isArray(pages) ? pages : [])
    .filter((p) => p && typeof p.url === 'string' && p.url.trim())
    .map((p) => ({ url: p.url.trim(), titre: typeof p.titre === 'string' ? p.titre.trim() : '' }));
  if (pages.length) return pages;

  const boutique = (Array.isArray(liens) ? liens : []).find(
    (l) => l && typeof l.url === 'string' && l.url.trim()
      && String(l.libelle ?? '').trim().toLowerCase() === 'boutique',
  );
  return boutique ? [{ url: boutique.url.trim(), titre: 'Boutique' }] : [];
}

async function formatSupport(row) {
  if (!row) return row;

  const out = { ...row };

  if (typeof out.liens === 'string') {
    try { out.liens = JSON.parse(out.liens); } catch { out.liens = []; }
  }

  out.pages_abonnements = pagesAbonnements(out.pages_abonnements, out.liens);

  if (typeof out.contenus === 'string') {
    out.contenus = out.contenus ? out.contenus.split(',').map(Number).filter(Boolean) : [];
  }

  Object.assign(out, await resolveLogoUrls(out.id));

  // Les magazines exposent leur dernière activité en date (avec l'URL de sa
  // couverture) : c'est le numéro courant du support.
  if (out.type_support === 'magazine') {
    out.derniere_activite = await getDerniereActivitePourSupport(out.id);
  }

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
 * Liste brute des supports actifs : les lignes de la table, sans résolution de
 * logo ni dernière activité (aucun aller-retour HTTP). Pour les traitements de
 * masse qui n'ont besoin que de l'identité du support.
 * @returns {Promise<Object[]>}
 */
export async function getSupportsBruts() {
  return await db('supports')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .orderBy([{ column: 'ordre', order: 'desc' }, { column: 'nom', order: 'asc' }]);
}

/**
 * Support brut par id numérique ou slug (pendant de `getSupportsBruts`).
 * @param {number|string} idOrSlug
 * @returns {Promise<Object|null>}
 */
export async function getSupportBrut(idOrSlug) {
  const query = db('supports')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (/^\d+$/.test(String(idOrSlug))) query.andWhere('id', idOrSlug);
  else query.andWhere('slug', idOrSlug);

  return (await query.first()) ?? null;
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
}

/**
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
}

/**
 * Champs « données de base » d'un support, seuls modifiables par l'API.
 *
 * En sont exclus : `trash` (cf. `archiverSupport()`), les colonnes d'auteur et
 * d'horodatage, et `nb_activite` — un compteur entretenu par sogest.
 */
const CHAMPS_MODIFIABLES = [
  'nom',
  'slug',
  'ordre',
  'description',
  'description_offres',
  'recurrence',
  'societe',
  'type_support',
  'contenus',
  'source_externe',
  'source_externe_article',
  'comptes_admin',
  'portail',
  'liens',
  'noms_alternatifs',
  'couleur_dominante',
  'adresse_pennylane',
  'indisponible',
];

/** Valeurs acceptées par la colonne `supports.type_support` (enum SQL). */
const TYPES_SUPPORT = ['magazine', 'projets', 'autre'];

/**
 * Sérialise vers le format de stockage les champs que `formatSupport()`
 * désérialise à la lecture, pour que l'API se relise elle-même : `liens` en
 * JSON, `contenus` et `comptes_admin` en CSV. Une chaîne est laissée telle
 * quelle — l'appelant peut toujours écrire la forme stockée directement.
 */
function serialiserChamps(champs) {
  const out = { ...champs };

  if (Array.isArray(out.liens) || (out.liens && typeof out.liens === 'object')) {
    out.liens = JSON.stringify(out.liens);
  }

  if (Array.isArray(out.contenus)) {
    out.contenus = out.contenus.map(Number).filter(Boolean).join(',');
  }

  // Textarea côté sogest : une ligne par compte, stocké en CSV.
  if (Array.isArray(out.comptes_admin)) {
    out.comptes_admin = out.comptes_admin.map((c) => String(c).trim()).filter(Boolean).join(',');
  } else if (typeof out.comptes_admin === 'string' && out.comptes_admin.includes('\n')) {
    out.comptes_admin = out.comptes_admin.split('\n').map((c) => c.trim()).filter(Boolean).join(',');
  }

  return out;
}

/** Ne retient de `data` que les champs modifiables effectivement fournis. */
function champsFournis(data) {
  const out = {};
  for (const champ of CHAMPS_MODIFIABLES) {
    if (data?.[champ] !== undefined) out[champ] = data[champ];
  }
  return serialiserChamps(out);
}

/**
 * Normalise le slug demandé (ou le dérive du nom) et refuse celui qu'un autre
 * support porte déjà. sogest ne vérifie pas l'unicité, mais l'API résout les
 * supports par slug (`GET /supports/slug/{slug}`) : un doublon en rendrait un
 * inatteignable. Plutôt que de trancher à la place de l'appelant en suffixant
 * le slug, on refuse l'écriture — à lui de choisir.
 *
 * @param {string} souhaite Slug demandé, ou nom du support à défaut
 * @param {number|null} exclureId Support en cours de modification
 * @returns {Promise<string>}
 * @throws {Error} `err.code = 'slug_existant'`, `err.slug` portant le slug pris
 */
async function resoudreSlug(souhaite, exclureId = null) {
  const slug = slugify(String(souhaite || ''));
  if (!slug) {
    const err = new Error('Slug vide : aucun caractère exploitable dans le nom');
    err.code = 'slug_invalide';
    throw err;
  }

  const query = db('supports').select('id', 'nom').where('slug', slug);
  if (exclureId) query.andWhere('id', '<>', exclureId);

  const pris = await query.first();
  if (pris) {
    const err = new Error(`Le slug « ${slug} » est déjà pris par le support « ${pris.nom} » (#${pris.id})`);
    err.code = 'slug_existant';
    err.slug = slug;
    throw err;
  }

  return slug;
}

/** Refuse une valeur hors enum : en SQL non strict elle serait écrite vide. */
function verifierTypeSupport(type) {
  if (type === undefined) return;
  if (!TYPES_SUPPORT.includes(type)) {
    const err = new Error(`type_support doit valoir ${TYPES_SUPPORT.join(', ')}`);
    err.code = 'type_support_invalide';
    throw err;
  }
}

/**
 * Crée un support.
 *
 * Le `slug` est dérivé du nom s'il n'est pas fourni ; dans les deux cas la
 * création est refusée si un autre support le porte déjà.
 *
 * @param {Object} data Champs de `CHAMPS_MODIFIABLES` (`nom` obligatoire)
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<Object>} Le support créé, au format `getSupport()`
 * @throws {Error} `err.code = 'nom_requis'` / `'type_support_invalide'` /
 *   `'slug_existant'` / `'slug_invalide'`
 */
export async function createSupport(data, auteur = null) {
  const champs = champsFournis(data);

  if (!String(champs.nom ?? '').trim()) {
    const err = new Error('Le nom du support est obligatoire');
    err.code = 'nom_requis';
    throw err;
  }
  verifierTypeSupport(champs.type_support);

  champs.nom = String(champs.nom).trim();
  champs.slug = await resoudreSlug(champs.slug || champs.nom);

  const [id] = await db('supports').insert({
    ...champs,
    createur: auteur?.nomComplet || 'api',
    createur_id: auteur?.id || 0,
    creation: new Date(),
  });

  // `getSupport()` écarte les supports archivés : on relit la ligne telle
  // quelle, pour renvoyer aussi un support créé d'emblée `indisponible`.
  return await formatSupport(await getSupportRow(id));
}

/**
 * Met à jour les données de base d'un support.
 *
 * Deux cascades, reprises de `actions/edit_support.php` (sogest) :
 * - un changement de `nom` se répercute sur `tarifs.support` et sur les
 *   activités du support (`support`, et le `libelle` qui en dérive) ;
 * - un changement de `indisponible` archive (ou désarchive) les tarifs et les
 *   activités du support, et masque (ou réaffiche) les piges de celles-ci.
 *
 * sogest suffixe en plus le nom du support de « [Support Indisponible] » à
 * l'archivage, et le retire à la restauration. C'est un artifice d'affichage
 * de son interface : l'API ne l'écrit pas, sans quoi le nom canonique — que
 * portent aussi `tarifs.support`, `activites.support` et les libellés —
 * s'en trouverait pollué.
 *
 * @param {number} id
 * @param {Object} data Champs de `CHAMPS_MODIFIABLES`
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<Object|null>} Le support à jour, ou `null` si introuvable
 * @throws {Error} `err.code = 'aucun_champ'` / `'nom_requis'` /
 *   `'type_support_invalide'` / `'slug_existant'` / `'slug_invalide'`
 */
export async function updateSupport(id, data, auteur = null) {
  const actuel = await getSupportRow(id);
  if (!actuel) return null;

  const champs = champsFournis(data);
  if (Object.keys(champs).length === 0) {
    const err = new Error('Aucun champ à mettre à jour');
    err.code = 'aucun_champ';
    throw err;
  }
  verifierTypeSupport(champs.type_support);

  if (champs.nom !== undefined) {
    champs.nom = String(champs.nom).trim();
    if (!champs.nom) {
      const err = new Error('Le nom du support est obligatoire');
      err.code = 'nom_requis';
      throw err;
    }
  }

  if (champs.slug !== undefined) champs.slug = await resoudreSlug(champs.slug || champs.nom || actuel.nom, actuel.id);

  champs.modificateur = auteur?.nomComplet || 'api';
  champs.modificateur_id = auteur?.id || 0;
  champs.modifications = Number(actuel.modifications || 0) + 1;

  await saveToHistorique('supports', actuel.id, auteur);
  await db('supports').where('id', actuel.id).update(champs);

  const nom = champs.nom !== undefined && champs.nom !== actuel.nom ? champs.nom : undefined;
  const indisponible =
    champs.indisponible !== undefined && Number(champs.indisponible) !== Number(actuel.indisponible)
      ? (Number(champs.indisponible) ? 1 : 0)
      : undefined;

  await cascaderSupport(actuel.id, { nom, indisponible });

  return await getSupportRow(actuel.id).then(formatSupport);
}

/** Ligne `supports` brute par id, sans aucun filtre (corbeille comprise). */
async function getSupportRow(id) {
  if (!id || isNaN(id)) return null;
  return (await db('supports').where('id', id).first()) ?? null;
}

/** Répercute nom / archivage sur les tarifs et les activités du support. */
async function cascaderSupport(supportId, { nom, indisponible } = {}) {
  if (nom === undefined && indisponible === undefined) return;

  const patchTarifs = {};
  if (nom !== undefined) patchTarifs.support = nom;
  if (indisponible !== undefined) patchTarifs.indisponible = indisponible;
  await db('tarifs').where('support_id', supportId).update(patchTarifs);

  await rafraichirActivitesDuSupport(supportId, { nom, indisponible });
}

/**
 * Archive — ou restaure — un support, avec les mêmes cascades que
 * `updateSupport()`. C'est l'action « Archiver ce support » de sogest, et la
 * seule forme de suppression qu'il connaisse : un support n'est jamais mis à
 * la corbeille, ses activités, tarifs et piges continuant de le référencer.
 *
 * @param {number} id
 * @param {0|1} [indisponible]
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<Object|null>} Le support à jour, ou `null` si introuvable
 */
export async function archiverSupport(id, indisponible = 1, auteur = null) {
  const actuel = await getSupportRow(id);
  if (!actuel) return null;

  return await updateSupport(actuel.id, { indisponible: Number(indisponible) ? 1 : 0 }, auteur);
}
