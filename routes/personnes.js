import express from 'express';
import { getPersonne, getPersonnes, updatePersonne } from '../inc/rh/personnes.js';
import { handleResponse } from '../inc/core/response.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personnes';

/**
 * @openapi
 * /personnes:
 *   get:
 *     tags: [Personnes]
 *     summary: Liste des personnes
 *     responses:
 *       200:
 *         description: Liste des personnes
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
  const personnes = await getPersonnes();
  return personnes;
}));


/**
 * @openapi
 * /personnes/{id}:
 *   get:
 *     tags: [Personnes]
 *     summary: Détails d'une personne
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer }, description: ID de la personne }
 *     responses:
 *       200: { description: Données de la personne, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  const personne = await getPersonne({ id: req.params.id });
  return personne;
}));


/**
 * @openapi
 * /personnes/{id}:
 *   put:
 *     tags: [Personnes]
 *     summary: Mise à jour d'une personne
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: true }
 *     responses:
 *       200: { description: Données modifiées, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
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

