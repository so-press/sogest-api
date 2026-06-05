import express from 'express';
import { getSupport, getSupports, renderSupportLogo } from '../inc/editorial/supports.js';
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
 * /supports/{id}:
 *   get:
 *     tags: [Supports]
 *     summary: Détails d'un support
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux supports de sa liste
 *       (`users.supports`), sinon `403`. Les admins / token statique accèdent à tout.
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
