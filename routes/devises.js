import express from 'express';
import dayjs from 'dayjs';
import { getAllDevises, getDevise, getTauxDevise } from '../inc/ndf/devises.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/devises';

/**
 * @openapi
 * /devises:
 *   get:
 *     tags: [Devises]
 *     summary: Liste des devises
 *     description: Liste enrichie (drapeau, name, slug) issue de la source externe.
 *     parameters:
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 }, description: 'Mettre un limit élevé pour tout récupérer' }
 *     responses:
 *       200:
 *         description: Liste paginée des devises
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async () => {
  return await getAllDevises();
}));

/**
 * @openapi
 * /devises/{code}/taux:
 *   get:
 *     tags: [Devises]
 *     summary: Taux d'une devise à une date (source externe)
 *     description: |
 *       `taux` est compatible Sogest : `EUR` = 1, et pour les autres devises c'est
 *       l'inverse du taux devise→EUR (EUR→devise), tel que
 *       `montant_eur = montant_devise / taux`.
 *     parameters:
 *       - { in: path,  name: code, required: true, schema: { type: string }, description: Code ISO (ex. USD) }
 *       - { in: query, name: date, schema: { type: string, format: date }, description: 'Date (défaut : aujourd''hui)' }
 *     responses:
 *       200:
 *         description: Taux à la date
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string }
 *                 date: { type: string, format: date }
 *                 taux: { type: number }
 *       400: { description: Date invalide }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       502: { description: Taux indisponible (source externe) }
 */
router.get('/:code/taux', handleResponse(async (req, res) => {
  const date = req.query.date || dayjs().format('YYYY-MM-DD');
  if (!dayjs(date).isValid()) {
    res.status(400);
    throw new Error('Invalid date');
  }

  const taux = await getTauxDevise(req.params.code, date);
  if (taux === null) {
    res.status(502);
    throw new Error('Taux indisponible');
  }
  return { code: req.params.code.toUpperCase(), date, taux };
}));

/**
 * @openapi
 * /devises/{code}:
 *   get:
 *     tags: [Devises]
 *     summary: Détail d'une devise (par code ou slug)
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string }, description: Code ISO ou slug }
 *     responses:
 *       200: { description: Données de la devise, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:code', handleResponse(async (req, res) => {
  const devise = await getDevise(req.params.code);
  if (!devise) {
    res.status(404);
    throw new Error('Devise not found');
  }
  return devise;
}));

export default router;
