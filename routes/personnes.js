import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personnes';

/**
 * Récupère la liste complète des personnes.
 *
 * @route GET /personnes
 * @returns {Object[]} Liste des personnes.
 * @throws {Error} En cas d’échec lors de la récupération.
 */

router.get('/', handleResponse(async (req, res) => {
  const personnes = await getPersonnes();
  return personnes;
}));


/**
 * Récupère les informations d'une personne spécifique selon son ID.
 *
 * @route GET /personnes/:id
 * @param {string} req.params.id - ID de la personne.
 * @returns {Object} Données de la personne demandée.
 * @throws {Error} Si la personne est introuvable ou en cas d’erreur serveur.
 */
router.get('/:id', handleResponse(async (req, res) => {
  const personne = await getPersonne({ id: req.params.id });
  return personne;
}));


/**
 * Met à jour les données d'une personne spécifique.
 *
 * @route PUT /personnes/:id
 * @param {string} req.params.id - ID de la personne à mettre à jour.
 * @param {Object} req.body - Données mises à jour.
 * @returns {Object} Données de la personne après modification.
 * @throws {Error} En cas d’échec de la mise à jour ou d’erreur serveur.
 */
router.put('/:id', handleResponse(async (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const updated = await updatePersonne(id, data);
  if (updated) {
    return await getPersonne({ id: req.params.id })
  }
}));

export default router;
