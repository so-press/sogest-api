import express from 'express';
import {
  listAbsences,
  getAbsence,
  findAbsence,
  createAbsence,
  updateAbsence,
  deleteAbsence,
  recapAbsences,
} from '../inc/rh/absences.js';
import { handleResponse } from '../inc/core/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';
// Toutes les routes nécessitent un utilisateur connecté (JWT, pas un token statique)
export const requireAuth = true;

/**
 * @openapi
 * /absences:
 *   get:
 *     tags: [Absences]
 *     summary: Liste filtrée des absences de l'utilisateur connecté
 *     description: L'utilisateur concerné est déterminé par le token JWT.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: type,  schema: { type: string }, description: 'Filtre sur le type (ex: conge)' }
 *       - { in: query, name: from,  schema: { type: string, format: date }, description: Date de début incluse }
 *       - { in: query, name: to,    schema: { type: string, format: date }, description: Date de fin incluse }
 *       - { in: query, name: year,  schema: { type: integer } }
 *       - { in: query, name: month, schema: { type: integer, minimum: 1, maximum: 12 }, description: Nécessite year }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [date, valeur, type, creation, id], default: date }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des absences
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
  const { type, from, to, year, month, sort, order } = req.query;
  return await listAbsences({
    userId: req.user.id,
    type: type || null,
    dateFrom: from || null,
    dateTo: to || null,
    year: year !== undefined ? parseInt(year, 10) : null,
    month: month !== undefined ? parseInt(month, 10) : null,
    sort,
    order,
  });
}));

/**
 * @openapi
 * /absences:
 *   post:
 *     tags: [Absences]
 *     summary: Pose une (ou plusieurs) absence(s)
 *     description: L'absence est toujours rattachée à l'utilisateur du token JWT.
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:   { type: string, format: date, description: Date de l'absence (mode unique) }
 *               dates:
 *                 type: array
 *                 description: |
 *                   Pose multiple. Chaque élément peut être une chaîne `"YYYY-MM-DD"`
 *                   (qui hérite des `type`/`valeur` globaux), ou un objet
 *                   `{ "date": "YYYY-MM-DD", "valeur": 0.5, "type": "rtt" }`.
 *                 items:
 *                   oneOf:
 *                     - { type: string, format: date }
 *                     - type: object
 *                       required: [date]
 *                       properties:
 *                         date:   { type: string, format: date }
 *                         type:   { type: string }
 *                         valeur: { type: number }
 *               type:   { type: string, default: conge }
 *               valeur: { type: number, default: 1, description: '1 = journée, 0.5 = demi-journée' }
 *     responses:
 *       201:
 *         description: Absence(s) créée(s)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - { type: object, description: Mode date unique }
 *                 - type: object
 *                   description: Mode dates multiples
 *                   properties:
 *                     created: { type: array, items: { type: object } }
 *                     skipped: { type: array, items: { type: string, format: date } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409: { description: Une absence existe déjà pour cet utilisateur à cette date }
 */
router.post('/', handleResponse(async (req, res) => {
  const { date, dates, type = 'conge', valeur = 1 } = req.body;
  const userId = req.user.id;

  // Pose multiple : un tableau de dates (chaînes et/ou objets par date)
  if (Array.isArray(dates)) {
    const created = [];
    const skipped = [];
    for (const entry of dates) {
      // Chaîne simple → hérite des type/valeur globaux ;
      // objet → surcharge possible de date/type/valeur au cas par cas
      const item = typeof entry === 'string' ? { date: entry } : (entry || {});
      const d = item.date;
      if (!d) {
        res.status(400);
        throw new Error('Each entry in "dates" must contain a date');
      }
      if (await findAbsence(userId, d)) {
        skipped.push(d);
        continue;
      }
      created.push(await createAbsence({
        user_id: userId,
        date: d,
        type: item.type ?? type,
        valeur: item.valeur ?? valeur,
      }));
    }
    res.status(201);
    return { created, skipped };
  }

  // Pose d'une seule absence
  if (!date) {
    res.status(400);
    throw new Error('Date is required');
  }

  if (await findAbsence(userId, date)) {
    res.status(409);
    throw new Error('An absence already exists for this user on this date');
  }

  res.status(201);
  return await createAbsence({ user_id: userId, date, type, valeur });
}));

/**
 * @openapi
 * /absences/{id}:
 *   put:
 *     tags: [Absences]
 *     summary: Modifie une absence
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:   { type: string, format: date }
 *               type:   { type: string }
 *               valeur: { type: number }
 *     responses:
 *       200: { description: Absence mise à jour, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: L'absence n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  if (existing.user_id !== req.user.id) {
    res.status(403);
    throw new Error('This absence does not belong to the current user');
  }

  await updateAbsence(id, req.body);
  return await getAbsence(id);
}));

/**
 * @openapi
 * /absences/{id}:
 *   delete:
 *     tags: [Absences]
 *     summary: Supprime une absence
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Confirmation de suppression
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted: { type: boolean }
 *                 id:      { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: L'absence n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  if (existing.user_id !== req.user.id) {
    res.status(403);
    throw new Error('This absence does not belong to the current user');
  }

  await deleteAbsence(id);
  return { deleted: true, id };
}));

/**
 * @openapi
 * /absences/recap:
 *   get:
 *     tags: [Absences]
 *     summary: Récapitulatif des absences de l'utilisateur connecté
 *     description: Totaux par type (somme des valeurs) sur une période.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: year, schema: { type: integer }, description: 'Défaut : année en cours' }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: Prioritaire sur year }
 *       - { in: query, name: to,   schema: { type: string, format: date }, description: Prioritaire sur year }
 *     responses:
 *       200:
 *         description: Récap par type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: integer }
 *                 from:   { type: string, format: date }
 *                 to:     { type: string, format: date }
 *                 total:  { type: number }
 *                 count:  { type: integer }
 *                 byType:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       jours: { type: number }
 *                       count: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/recap', handleResponse(async (req) => {
  const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
  const from = req.query.from || `${year}-01-01`;
  const to = req.query.to || `${year}-12-31`;

  const recap = await recapAbsences({ userId: req.user.id, dateFrom: from, dateTo: to });
  return { userId: req.user.id, from, to, ...recap };
}));

export default router;
