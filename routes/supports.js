import express from 'express';
import { getSupport, getSupportBrut, getSupportBySlug, getSupports, getSupportsBruts, renderSupportLogo } from '../inc/editorial/supports.js';
import { getCalendrier } from '../inc/editorial/calendrier.js';
import { listActivites, withCouvertures } from '../inc/editorial/activites.js';
import { getUserSupportIds } from '../inc/rh/users.js';
import { isAdminRequest } from '../inc/core/access.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/supports';

// Router public (monté avant authMiddleware par server.js) : le logo est une
// ressource de marque, destinée à être embarquée dans un <img src> qui ne peut
// pas porter de header Authorization.
const publicRouter = express.Router();

const HEX = /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * @openapi
 * /supports/{id}/{format}:
 *   get:
 *     tags: [Supports]
 *     summary: Logo brut d'un support (image)
 *     description: |
 *       Renvoie le **contenu image** du logo du support (route publique, sans
 *       authentification — pensée pour un `<img src>`). `format` vaut `svg` ou
 *       `png`. Le slug `so-press` fonctionne comme tout autre id/slug.
 *
 *       Avec le segment optionnel `couleur` (hexa **sans** `#`, 3 ou 6 chiffres) :
 *       - **svg** → le `fill` du SVG est réécrit avec cette couleur ;
 *       - **png** → aplat de couleur façon « Color Overlay » Photoshop, la
 *         transparence d'origine étant conservée.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug (ex. `so-press`)
 *       - in: path
 *         name: format
 *         required: true
 *         schema: { type: string, enum: [svg, png] }
 *       - in: path
 *         name: couleur
 *         required: false
 *         schema: { type: string, pattern: '^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }
 *         description: Couleur hexadécimale sans `#` (ex. `ff0000` ou `f00`)
 *     responses:
 *       200:
 *         description: Contenu du logo
 *         content:
 *           image/svg+xml: { schema: { type: string } }
 *           image/png:     { schema: { type: string, format: binary } }
 *       400: { description: Couleur hexadécimale invalide }
 *       404: { description: Support ou logo introuvable }
 */
publicRouter.get('/:supportId/:format(svg|png)/:color?', async (req, res) => {
  const { supportId, format, color } = req.params;

  if (color && !HEX.test(color)) {
    return res.status(400).json({ error: 'Invalid color', message: 'Couleur hexadécimale invalide (3 ou 6 chiffres, sans #)' });
  }

  try {
    const logo = await renderSupportLogo(supportId, format, color);
    if (!logo) {
      return res.status(404).json({ error: 'Not found', message: 'Logo introuvable' });
    }
    // output headers image svg ou png
    res.set('Content-type', logo.contentType);
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.type(logo.contentType);
    res.send(logo.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', message: '' + err });
  }
});

export { publicRouter };

/**
 * @openapi
 * /supports:
 *   get:
 *     tags: [Supports]
 *     summary: Liste des supports actifs
 *     description: |
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit tous les supports. Un utilisateur standard ne voit que les
 *       supports de sa liste (`users.supports`) ; liste vide s'il n'en a aucun.
 *
 *       **Magazines** : les supports `type_support = magazine` portent en plus
 *       `derniere_activite`, l'activité la plus récente du support (par
 *       `date_bouclage`, `id` en départage), avec son `couverture` (URL de
 *       l'image de couv, ou `null`). `null` si le support n'a aucune activité.
 *     responses:
 *       200:
 *         description: Liste paginée des supports
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req) => {
  const all = await getSupports();
  if (isAdminRequest(req)) return all;
  const ids = new Set(await getUserSupportIds(req.user?.id));
  return all.filter((s) => ids.has(s.id));
}));

/**
 * @openapi
 * /supports/slug/{slug}:
 *   get:
 *     tags: [Supports]
 *     summary: Détails d'un support par son slug
 *     description: |
 *       Recherche explicitement par `slug` (jamais par id numérique).
 *       Un utilisateur standard ne peut accéder qu'aux supports de sa liste
 *       (`users.supports`), sinon `403`. Les admins / token statique accèdent à tout.
 *
 *       **Magazines** : les supports `type_support = magazine` portent en plus
 *       `derniere_activite`, l'activité la plus récente du support (par
 *       `date_bouclage`, `id` en départage), avec son `couverture` (URL de
 *       l'image de couv, ou `null`). `null` si le support n'a aucune activité.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *         description: Slug du support
 *     responses:
 *       200: { description: Données du support, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/slug/:slug', handleResponse(async (req, res) => {
  const support = await getSupportBySlug(req.params.slug);
  if (!support) {
    res.status(404);
    throw new Error('Support not found');
  }
  if (!isAdminRequest(req)) {
    const ids = new Set(await getUserSupportIds(req.user?.id));
    if (!ids.has(support.id)) {
      res.status(403);
      throw new Error('Support hors de votre périmètre');
    }
  }
  return support;
}));

/**
 * @openapi
 * /supports/calendrier:
 *   get:
 *     tags: [Supports]
 *     summary: Calendrier de parution, rapproché des activités
 *     description: |
 *       Calendrier de parution **unifié** : les items (les parutions prévues)
 *       viennent de Mahalo, les activités de sogest. Chaque item est toujours
 *       présent, qu'une activité lui corresponde ou non — un item sans activité
 *       est une parution à venir (ou jamais saisie), pas une anomalie.
 *
 *       Sans filtre, la route renvoie le calendrier de **tous les supports
 *       confondus** ; `supportId` (id numérique ou slug) le restreint à un seul.
 *       La notion de « titre » Mahalo n'apparaît jamais : la correspondance
 *       support sogest ↔ titre Mahalo est faite en interne (table de transco).
 *       Un support sans correspondance arbitrée, ou géré « date à date » (donc
 *       sans calendrier chez Mahalo), n'apporte simplement aucun item.
 *
 *       **Rapprochement** (champ `rapprochement`) :
 *       - `numero` — `activites.numero` = numéro de parution ;
 *       - `dates` — à défaut, activité dont `date_bouclage` tombe dans la
 *         période de parution de l'item ;
 *       - `null` — item non rapproché, `activites` est vide.
 *
 *       Un numéro pouvant porter plusieurs activités, `activites` est **toujours
 *       un tableau**. Une activité n'est jamais rattachée à deux items.
 *
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit tous les supports et toutes leurs activités. Un
 *       utilisateur standard ne voit que les supports de sa liste
 *       (`users.supports`) et, dessus, ne voit rattachées que les activités
 *       ayant une pige à son nom ou qu'il a créées — les autres items restent
 *       visibles, simplement sans activité.
 *
 *       **Dates** : `date_debut` / `date_fin` sont des dates civiles
 *       `YYYY-MM-DD` déjà converties en `Europe/Paris` (Mahalo les publie en UTC).
 *     parameters:
 *       - { in: query, name: supportId, schema: { type: string }, description: "Id numérique ou slug d'un support ; par défaut tous les supports du périmètre. Équivalent de `GET /supports/{id}/calendrier`" }
 *       - { in: query, name: du, schema: { type: string, format: date }, description: "Ne garder que les items dont la période de parution finit à partir de cette date" }
 *       - { in: query, name: au, schema: { type: string, format: date }, description: "Ne garder que les items dont la période de parution commence avant cette date" }
 *       - { in: query, name: avecActivite, schema: { type: string, enum: ['1', '0'] }, description: "`1` = seulement les items rapprochés à une activité, `0` = seulement les orphelins" }
 *       - { in: query, name: couvertures, schema: { type: string, enum: ['1'] }, description: "Résout l'URL `couverture` des activités des supports `magazine` (coûteux, opt-in)" }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc }, description: "Tri sur `date_debut`" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des items de calendrier
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:            { type: string, example: '2-2043', description: "Identifiant de l'item (`{support_id}-{ref parution Mahalo}`)" }
 *                       support_id:    { type: integer, example: 2 }
 *                       support:       { type: string, example: 'SO FOOT' }
 *                       support_slug:  { type: string, example: 'so-foot' }
 *                       numero:        { type: [integer, 'null'], example: 238 }
 *                       libelle:       { type: [string, 'null'], example: 'févr-18' }
 *                       supplement:    { type: [string, 'null'] }
 *                       code_parution: { type: [string, 'null'] }
 *                       date_debut:    { type: [string, 'null'], format: date, example: '2026-07-04' }
 *                       date_fin:      { type: [string, 'null'], format: date, example: '2026-09-04' }
 *                       date_validation: { type: [string, 'null'], format: date }
 *                       rapprochement: { type: [string, 'null'], enum: [numero, dates, null] }
 *                       activites:     { type: array, items: { type: object }, description: 'Activités sogest rattachées (vide si aucune)' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { description: Support introuvable }
 */
/**
 * Handler partagé des deux routes de calendrier. `cible` est un id numérique ou
 * un slug de support, ou `null` pour tous les supports du périmètre.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string|null} cible
 * @returns {Promise<Object[]>}
 */
async function repondreCalendrier(req, res, cible) {
  const admin = isAdminRequest(req);
  const { du, au, order, couvertures } = req.query;

  let supports;
  if (cible) {
    const support = await getSupportBrut(cible);
    if (!support) {
      res.status(404);
      throw new Error('Support not found');
    }
    if (!admin) {
      const ids = new Set(await getUserSupportIds(req.user?.id));
      if (!ids.has(support.id)) {
        res.status(403);
        throw new Error('Support hors de votre périmètre');
      }
    }
    supports = [support];
  } else {
    supports = await getSupportsBruts();
    if (!admin) {
      const ids = new Set(await getUserSupportIds(req.user?.id));
      supports = supports.filter((s) => ids.has(s.id));
    }
  }

  const av = req.query.avecActivite;
  const avecActivite = av === undefined || av === ''
    ? null
    : !(av === '0' || av === 'false');

  return await getCalendrier({
    supports,
    du: du || null,
    au: au || null,
    avecActivite,
    order,
    couvertures: couvertures !== undefined && couvertures !== '0' && couvertures !== 'false',
    ...(admin ? {} : {
      personneId: req.user?.personne_id ?? 0,
      userId: req.user?.id ?? 0,
    }),
  });
}

router.get('/calendrier', handleResponse((req, res) => repondreCalendrier(req, res, req.query.supportId || null)));

/**
 * @openapi
 * /supports/{id}/calendrier:
 *   get:
 *     tags: [Supports]
 *     summary: Calendrier de parution d'un support
 *     description: |
 *       Strictement le même contenu que `GET /supports/calendrier?supportId={id}`,
 *       le support étant porté par le chemin — le pendant de
 *       `GET /supports/{id}/activites`. Tous les autres paramètres (`du`, `au`,
 *       `avecActivite`, `couvertures`, `order`, pagination) sont identiques.
 *
 *       Voir `GET /supports/calendrier` pour le détail du rapprochement
 *       items ↔ activités et du périmètre.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug du support
 *       - { in: query, name: du, schema: { type: string, format: date }, description: "Ne garder que les items dont la période de parution finit à partir de cette date" }
 *       - { in: query, name: au, schema: { type: string, format: date }, description: "Ne garder que les items dont la période de parution commence avant cette date" }
 *       - { in: query, name: avecActivite, schema: { type: string, enum: ['1', '0'] }, description: "`1` = seulement les items rapprochés à une activité, `0` = seulement les orphelins" }
 *       - { in: query, name: couvertures, schema: { type: string, enum: ['1'] }, description: "Résout l'URL `couverture` des activités si le support est un `magazine`" }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc }, description: "Tri sur `date_debut`" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des items de calendrier du support
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:supportId/calendrier', handleResponse((req, res) => repondreCalendrier(req, res, req.params.supportId)));


/**
 * @openapi
 * /supports/{id}/activites:
 *   get:
 *     tags: [Supports]
 *     summary: Activités d'un support
 *     description: |
 *       Activités du support (hors corbeille et non indisponibles), triées par
 *       période décroissante par défaut. Même contenu que `GET /activites`,
 *       restreint à un support.
 *
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit tout. Un utilisateur standard doit avoir le support dans
 *       sa liste (`users.supports`, sinon `403`) et ne voit alors que les
 *       activités ayant au moins une pige liée à son `personne_id`, ou qu'il a
 *       lui-même créées.
 *
 *       **Magazines** : si le support est de `type_support = magazine`, chaque
 *       activité porte en plus `couverture` (URL de l'image de couv, ou `null`),
 *       comme `derniere_activite` sur le support.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug du support
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [libelle, id, periode, numero], default: periode }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: s, schema: { type: string }, description: "Recherche plein-texte (LIKE) sur le libellé" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des activités du support
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:supportId/activites', handleResponse(async (req, res) => {
  const support = await getSupport(req.params.supportId);
  if (!support) {
    res.status(404);
    throw new Error('Support not found');
  }

  const admin = isAdminRequest(req);
  if (!admin) {
    const ids = new Set(await getUserSupportIds(req.user?.id));
    if (!ids.has(support.id)) {
      res.status(403);
      throw new Error('Support hors de votre périmètre');
    }
  }

  const { sort, order, s } = req.query;

  const activites = await listActivites({
    sort,
    order,
    search: s || null,
    supportId: support.id,
    ...(admin ? {} : {
      personneId: req.user?.personne_id ?? 0,
      userId: req.user?.id ?? 0,
    }),
  });

  // Sur un magazine, chaque activité est un numéro : on résout sa couverture
  // comme le fait `derniere_activite` sur le support.
  if (support.type_support !== 'magazine') return activites;
  return await withCouvertures(activites);
}));

/**
 * @openapi
 * /supports/{id}:
 *   get:
 *     tags: [Supports]
 *     summary: Détails d'un support
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux supports de sa liste
 *       (`users.supports`), sinon `403`. Les admins / token statique accèdent à tout.
 *
 *       **Magazines** : les supports `type_support = magazine` portent en plus
 *       `derniere_activite`, l'activité la plus récente du support (par
 *       `date_bouclage`, `id` en départage), avec son `couverture` (URL de
 *       l'image de couv, ou `null`). `null` si le support n'a aucune activité.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant numérique ou slug
 *     responses:
 *       200: { description: Données du support, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Support hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:supportId', handleResponse(async (req, res) => {
  const support = await getSupport(req.params.supportId);
  if (!support) {
    res.status(404);
    throw new Error('Support not found');
  }
  if (!isAdminRequest(req)) {
    const ids = new Set(await getUserSupportIds(req.user?.id));
    if (!ids.has(support.id)) {
      res.status(403);
      throw new Error('Support hors de votre périmètre');
    }
  }
  return support;
}));

export default router;
