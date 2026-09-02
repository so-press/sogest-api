import express from 'express';
import { getEquipe, getEquipeBySlug, getEquipes, getEquipesByUserId, getMembresEquipe, isUserInEquipe } from '../inc/rh/equipes.js';
import { handleResponse } from '../inc/core/response.js';
import { isAdminRequest } from '../inc/core/access.js';

const router = express.Router();
export const routePath = '/equipes';

/**
 * @openapi
 * /equipes:
 *   get:
 *     tags: [Equipes]
 *     summary: Liste des équipes (visibles, hors corbeille par défaut)
 *     parameters:
 *       - { in: query, name: all, schema: { type: boolean, default: false }, description: "Si vrai, inclut aussi les équipes non visibles" }
 *     responses:
 *       200:
 *         description: Liste paginée des équipes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
  const all = ['1', 'true', 'yes'].includes(String(req.query.all).toLowerCase());
  return await getEquipes({ all });
}));

/**
 * @openapi
 * /equipes/user:
 *   get:
 *     tags: [Equipes]
 *     summary: Équipes de l'utilisateur connecté
 *     description: L'utilisateur est déterminé par le token JWT. Un token applicatif statique est refusé ici.
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200:
 *         description: Liste des équipes de l'utilisateur (avec son `role`)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/user', handleResponse(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('JWT authentication required');
  }
  return await getEquipesByUserId(req.user.id);
}));

/**
 * @openapi
 * /equipes/slug/{slug}:
 *   get:
 *     tags: [Equipes]
 *     summary: Détails d'une équipe par son slug
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Données de l'équipe, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/slug/:slug', handleResponse(async (req, res) => {
  const equipe = await getEquipeBySlug(req.params.slug);
  if (!equipe) {
    res.status(404);
    throw new Error('Equipe not found');
  }
  return equipe;
}));

/**
 * @openapi
 * /equipes/{id}/membres:
 *   get:
 *     tags: [Equipes]
 *     summary: Membres d'une équipe
 *     description: |
 *       Utilisateurs actifs rattachés à l'équipe, au même format que `GET /users`
 *       (avatar, links…), enrichis de leur `role` dans l'équipe et de la date de
 *       rattachement (`membre_depuis`).
 *
 *       **Périmètre** : un admin (ou un token applicatif statique, cf.
 *       `isAdminRequest`) voit les membres de n'importe quelle équipe ; un
 *       utilisateur lambda uniquement ceux des équipes dont il fait lui-même
 *       partie, sinon **403**.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identifiant numérique ou slug de l'équipe
 *         schema: { type: string }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des membres de l'équipe
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
 *                       id:            { type: integer }
 *                       nom:           { type: string }
 *                       prenom:        { type: string }
 *                       email:         { type: string }
 *                       role:          { type: string, nullable: true, description: "Rôle dans l'équipe" }
 *                       membre_depuis: { type: string, format: date-time, nullable: true }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "L'utilisateur n'est pas membre de cette équipe" }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:equipeId/membres', handleResponse(async (req, res) => {
  const equipe = await getEquipe(req.params.equipeId);
  if (!equipe) {
    res.status(404);
    throw new Error('Equipe not found');
  }

  if (!isAdminRequest(req)) {
    // Utilisateur lambda : seulement les équipes dont il fait partie.
    if (!req.user || !(await isUserInEquipe(req.user.id, equipe.id))) {
      res.status(403);
      throw new Error('Forbidden: you are not a member of this equipe');
    }
  }

  return await getMembresEquipe(equipe.id);
}));

/**
 * @openapi
 * /equipes/{id}:
 *   get:
 *     tags: [Equipes]
 *     summary: Détails d'une équipe par son id ou son slug
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identifiant numérique ou slug
 *         schema: { type: string }
 *     responses:
 *       200: { description: Données de l'équipe, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:equipeId', handleResponse(async (req, res) => {
  const equipe = await getEquipe(req.params.equipeId);
  if (!equipe) {
    res.status(404);
    throw new Error('Equipe not found');
  }
  return equipe;
}));

export default router;
