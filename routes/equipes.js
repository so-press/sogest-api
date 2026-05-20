import express from 'express';
import { getEquipe, getEquipes } from '../inc/equipes.js';
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
 * @api {get} /equipes/:id Détails d'une équipe
 * @apiName GetEquipe
 * @apiGroup Equipes
 * @apiParam {Number} id Identifiant de l'équipe
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
