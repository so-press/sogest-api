import express from 'express';
import { listProjets, getProjet, personneCanAccessProjet } from '../inc/editorial/projets.js';
import { isAdminRequest } from '../inc/core/access.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/projets';

/**
 * @openapi
 * /projets:
 *   get:
 *     tags: [Projets]
 *     summary: Liste des projets sélectionnables
 *     description: |
 *       Projets hors corbeille et non indisponibles, triés par date de début
 *       décroissante (plus récents d'abord) par défaut.
 *
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit tous les projets. Un utilisateur standard ne voit que les
 *       projets ayant au moins un contrat lié à son `personne_id`, ou dont il est
 *       le responsable (`responsable_id`).
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [libelle, id, date_debut, date_fin], default: date_debut }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: s, schema: { type: string }, description: "Recherche plein-texte (LIKE) sur le libellé" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des projets
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
  const { sort, order, s } = req.query;
  const personneId = isAdminRequest(req) ? null : (req.user?.personne_id ?? 0);
  return await listProjets({ sort, order, personneId, search: s || null });
}));

/**
 * @openapi
 * /projets/{id}:
 *   get:
 *     tags: [Projets]
 *     summary: Détail d'un projet
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux projets sur lesquels il a
 *       au moins un contrat, ou dont il est le responsable (sinon `403`). Les
 *       admins / token statique accèdent à tout.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données du projet, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Projet hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const projet = await getProjet(id);
  if (!projet) {
    res.status(404);
    throw new Error('Projet not found');
  }
  if (!isAdminRequest(req) && !(await personneCanAccessProjet(req.user?.personne_id, id))) {
    res.status(403);
    throw new Error('Projet hors de votre périmètre');
  }
  return projet;
}));

export default router;
