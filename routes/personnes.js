import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/personnes.js';
import { handleResponse } from '../inc/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personnes';

/**
 * @openapi
 * /personnes:
 *   get:
 *     summary: Liste des personnes
 *     tags:
 *       - Personnes
 *     responses:
 *       200:
 *         description: Liste des personnes
 */

router.get('/', handleResponse(async (req, res) => {
  const personnes = await getPersonnes();
  return personnes;
}));


/**
 * @openapi
 * /personnes/{id}:
 *   get:
 *     summary: Détails d'une personne
 *     tags:
 *       - Personnes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Données de la personne
 */
router.get('/:id', handleResponse(async (req, res) => {
  const personne = await getPersonne({ id: req.params.id });
  return personne;
}));


/**
 * @openapi
 * /personnes/{id}:
 *   put:
 *     summary: Mise à jour d'une personne
 *     tags:
 *       - Personnes
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Données modifiées
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

