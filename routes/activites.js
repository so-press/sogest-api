import express from 'express';
import { listActivites, getActivite, userCanAccessActivite } from '../inc/activites.js';
import { isAdminRequest } from '../inc/access.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/activites';

/**
 * @openapi
 * /activites:
 *   get:
 *     tags: [Activités]
 *     summary: Liste des activités sélectionnables
 *     description: |
 *       Activités hors corbeille et non indisponibles, triées par période
 *       décroissante (plus récentes d'abord) par défaut.
 *
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit toutes les activités. Un utilisateur standard ne voit que
 *       les activités ayant au moins une pige liée à son `personne_id`, ou qu'il
 *       a lui-même créées.
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [libelle, id, periode, numero], default: periode }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des activités
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
  const { sort, order } = req.query;
  if (isAdminRequest(req)) {
    return await listActivites({ sort, order });
  }
  return await listActivites({
    sort,
    order,
    personneId: req.user?.personne_id ?? 0,
    userId: req.user?.id ?? 0,
  });
}));

/**
 * @openapi
 * /activites/{id}:
 *   get:
 *     tags: [Activités]
 *     summary: Détail d'une activité
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux activités sur lesquelles il
 *       a une pige, ou qu'il a créées (sinon `403`). Les admins / token statique
 *       accèdent à tout.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données de l'activité, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Activité hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const activite = await getActivite(id);
  if (!activite) {
    res.status(404);
    throw new Error('Activite not found');
  }
  if (!isAdminRequest(req) && !(await userCanAccessActivite(req.user?.personne_id ?? 0, req.user?.id ?? 0, id))) {
    res.status(403);
    throw new Error('Activité hors de votre périmètre');
  }
  return activite;
}));

export default router;
