import express from 'express';
import { getEquipe, getEquipeBySlug, getEquipes, getEquipesByUserId } from '../inc/equipes.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
export const routePath = '/equipes';

/**
 * @api {get} /equipes Liste des équipes
 * @apiName GetEquipes
 * @apiGroup Equipes
 * @apiParam {Boolean} [all=false] Si vrai (`?all=1`), inclut aussi les équipes non visibles
 * @apiUse globalToken
 * @apiSuccess {Object[]} data Liste des équipes (visibles par défaut, hors corbeille)
 */
router.get('/', handleResponse(async (req, res) => {
  const all = ['1', 'true', 'yes'].includes(String(req.query.all).toLowerCase());
  return await getEquipes({ all });
}));

/**
 * @api {get} /equipes/user Équipes de l'utilisateur connecté
 * @apiName GetMyEquipes
 * @apiGroup Equipes
 * @apiDescription L'utilisateur est déterminé par le token JWT. Nécessite un JWT (pas un token statique).
 * @apiUse JwtHeader
 * @apiSuccess {Object[]} data Liste des équipes de l'utilisateur (avec son `role`)
 * @apiError 401 Authentification JWT requise
 */
router.get('/user', handleResponse(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('JWT authentication required');
  }
  return await getEquipesByUserId(req.user.id);
}));

/**
 * @api {get} /equipes/slug/:slug Détails d'une équipe par son slug
 * @apiName GetEquipeBySlug
 * @apiGroup Equipes
 * @apiParam {String} slug Slug de l'équipe
 * @apiUse globalToken
 * @apiSuccess {Object} equipe Données de l'équipe
 * @apiError 404 Équipe introuvable
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
 * @api {get} /equipes/:id Détails d'une équipe par son id ou son slug
 * @apiName GetEquipe
 * @apiGroup Equipes
 * @apiParam {Number|String} id Identifiant ou slug de l'équipe
 * @apiUse globalToken
 * @apiSuccess {Object} equipe Données de l'équipe
 * @apiError 404 Équipe introuvable
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
