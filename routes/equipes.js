import express from 'express';
import { getEquipe, getEquipeBySlug, getEquipes, getEquipesByUserId } from '../inc/equipes.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/equipes';

/**
 * @openapi
 * /equipes:
 *   get:
 *     tags: [Equipes]
 *     summary: Liste des équipes (visibles, hors corbeille par défaut)
 *     parameters:
 *       - { in: query, name: all, schema: { type: boolean, default: false }, description: Si vrai, inclut aussi les équipes non visibles }
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
 * /equipes/{id}:
 *   get:
 *     tags: [Equipes]
 *     summary: Détails d'une équipe par son id ou son slug
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, description: Identifiant numérique ou slug }
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
