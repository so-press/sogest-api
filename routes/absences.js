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
import { listAbsencesHistorique } from '../inc/rh/absences_historique.js';
import { handleResponse } from '../inc/core/response.js';
import { isUltraAdminRequest } from '../inc/core/access.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';
// Toutes les routes nécessitent un utilisateur connecté (JWT, pas un token statique)
export const requireAuth = true;

/**
 * Utilisateur ciblé par la requête : l'appelant par défaut, ou un autre
 * utilisateur si `userId` (query) ou `user_id` (corps) est fourni.
 *
 * Cibler un tiers est **réservé aux ultra admins** : ils peuvent consulter et
 * saisir le planning d'absences d'un collaborateur (écran « planning de … » de
 * l'app absences). L'historique conserve la distinction, `user_id` étant le
 * collaborateur concerné et `auteur_id` celui qui a agi.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {number}
 */
function cibleUserId(req, res) {
  const brut = req.query?.userId ?? req.body?.user_id;
  if (brut === undefined || brut === null || brut === '') return req.user.id;

  const cible = parseInt(brut, 10);
  if (isNaN(cible)) {
    res.status(400);
    throw new Error('Invalid user ID');
  }
  if (cible !== req.user.id && !isUltraAdminRequest(req)) {
    res.status(403);
    throw new Error("Réservé aux administrateurs : accès au planning d'un tiers");
  }
  return cible;
}

/**
 * @openapi
 * /absences:
 *   get:
 *     tags: [Absences]
 *     summary: Liste filtrée des absences de l'utilisateur connecté
 *     description: |
 *       L'utilisateur concerné est déterminé par le token JWT, sauf si `userId`
 *       est fourni : consulter le planning d'un tiers est réservé aux ultra
 *       admins (sinon `403`).
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: userId, schema: { type: integer }, description: 'Autre utilisateur (ultra admins uniquement)' }
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
router.get('/', handleResponse(async (req, res) => {
  const { type, from, to, year, month, sort, order } = req.query;
  return await listAbsences({
    userId: cibleUserId(req, res),
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
 *     description: |
 *       L'absence est rattachée à l'utilisateur du token JWT, sauf si `user_id`
 *       est fourni dans le corps : saisir pour un tiers est réservé aux ultra
 *       admins (sinon `403`).
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id: { type: integer, description: 'Collaborateur concerné (ultra admins uniquement ; défaut : le porteur du JWT)' }
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
  const userId = cibleUserId(req, res);

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
 *       403: { description: L'absence n'appartient pas à l'utilisateur connecté (et il n'est pas ultra admin) }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  // Un ultra admin peut agir sur le planning d'un tiers (cf. cibleUserId).
  if (existing.user_id !== req.user.id && !isUltraAdminRequest(req)) {
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
 *       403: { description: L'absence n'appartient pas à l'utilisateur connecté (et il n'est pas ultra admin) }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  // Un ultra admin peut agir sur le planning d'un tiers (cf. cibleUserId).
  if (existing.user_id !== req.user.id && !isUltraAdminRequest(req)) {
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
 *     description: |
 *       Totaux par type (somme des valeurs) sur une période. `userId` permet de
 *       viser un autre collaborateur (ultra admins uniquement, sinon `403`).
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: userId, schema: { type: integer }, description: 'Autre utilisateur (ultra admins uniquement)' }
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
router.get('/recap', handleResponse(async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
  const from = req.query.from || `${year}-01-01`;
  const to = req.query.to || `${year}-12-31`;

  const userId = cibleUserId(req, res);
  const recap = await recapAbsences({ userId, dateFrom: from, dateTo: to });
  return { userId, from, to, ...recap };
}));

/**
 * @openapi
 * /absences/historique:
 *   get:
 *     tags: [Absences]
 *     summary: Historique des actions sur les absences de l'utilisateur connecté
 *     description: |
 *       Une ligne est enregistrée à chaque pose (`create`), modification (`update`)
 *       et suppression (`delete`) d'une absence, avec l'état avant/après et l'auteur
 *       de l'action. L'historique subsiste après la suppression de l'absence.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: action,    schema: { type: string, enum: [create, update, delete] } }
 *       - { in: query, name: type,      schema: { type: string }, description: 'Type d''absence au moment de l''action (ex: conge)' }
 *       - { in: query, name: absenceId, schema: { type: integer }, description: Filtre sur une absence précise }
 *       - { in: query, name: search,    schema: { type: string }, description: 'Recherche libre (auteur, type, date de l''absence)' }
 *       - { in: query, name: from,      schema: { type: string, format: date }, description: Date d'action de début incluse }
 *       - { in: query, name: to,        schema: { type: string, format: date }, description: Date d'action de fin incluse }
 *       - { in: query, name: sort,      schema: { type: string, enum: [dateheure, date, action, id], default: dateheure } }
 *       - { in: query, name: order,     schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,      schema: { type: integer } }
 *       - { in: query, name: limit,     schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des entrées d'historique
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
 *                       id:         { type: integer }
 *                       action:     { type: string, enum: [create, update, delete] }
 *                       absence_id: { type: integer }
 *                       user_id:    { type: integer }
 *                       auteur_id:  { type: integer, nullable: true }
 *                       auteur:     { type: string, nullable: true }
 *                       date:       { type: string, format: date, nullable: true }
 *                       type:       { type: string, nullable: true }
 *                       valeur:     { type: number, nullable: true }
 *                       avant:      { type: object, nullable: true }
 *                       apres:      { type: object, nullable: true }
 *                       ip:         { type: string, nullable: true }
 *                       dateheure:  { type: string, format: date-time }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/historique', handleResponse(async (req) => {
  const { action, type, absenceId, from, to, search, sort, order } = req.query;
  return await listAbsencesHistorique({
    userId: req.user.id,
    action: action || null,
    type: type || null,
    absenceId: absenceId !== undefined ? parseInt(absenceId, 10) : null,
    dateFrom: from || null,
    dateTo: to || null,
    search: search || null,
    sort,
    order,
  });
}));

/**
 * @openapi
 * /absences/historique/tous:
 *   get:
 *     tags: [Absences]
 *     summary: Historique des saisies d'absences de tous les utilisateurs (ultra admin)
 *     description: |
 *       Même contenu que `GET /absences/historique`, mais **sans restriction au
 *       périmètre de l'appelant** : toutes les saisies, tous utilisateurs
 *       confondus. Destiné à l'écran d'administration « Historique des saisies »
 *       de l'app absences.
 *
 *       **Accès réservé aux ultra admins** : `users.level = 'admin'` **et**
 *       colonne `users.ultra_admin` renseignée (même définition que la capacité
 *       `can.ultraAdmin` du payload de login). Sinon `403`.
 *       Comme toutes les routes `/absences`, le token statique est refusé
 *       (`requireAuth = true`).
 *
 *       Chaque ligne est enrichie du nom de l'utilisateur concerné
 *       (`utilisateur`, `utilisateur_email`) et du nom courant de l'auteur
 *       (`auteur_nom`) ; la colonne `auteur` conserve le nom figé au moment de
 *       l'action. L'historique subsiste après la suppression de l'absence.
 *
 *       `search` est une recherche libre (LIKE) appliquée en OR sur le nom et
 *       l'email de l'utilisateur concerné, le nom de l'auteur, le type
 *       d'absence et la date de l'absence.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: search,    schema: { type: string }, description: 'Recherche libre (utilisateur, auteur, type, date de l''absence)' }
 *       - { in: query, name: userId,    schema: { type: integer }, description: Filtre sur l'utilisateur concerné }
 *       - { in: query, name: auteurId,  schema: { type: integer }, description: Filtre sur l'auteur de l'action }
 *       - { in: query, name: action,    schema: { type: string, enum: [create, update, delete] } }
 *       - { in: query, name: type,      schema: { type: string }, description: 'Type d''absence au moment de l''action (ex: conge)' }
 *       - { in: query, name: absenceId, schema: { type: integer }, description: Filtre sur une absence précise }
 *       - { in: query, name: from,      schema: { type: string, format: date }, description: Date d'action de début incluse }
 *       - { in: query, name: to,        schema: { type: string, format: date }, description: Date d'action de fin incluse }
 *       - { in: query, name: sort,      schema: { type: string, enum: [dateheure, date, action, id], default: dateheure } }
 *       - { in: query, name: order,     schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,      schema: { type: integer } }
 *       - { in: query, name: limit,     schema: { type: integer, default: 50 } }
 *       - { in: query, name: count,     schema: { type: boolean }, description: Ne renvoie que le bloc `pagination` (dont `total`) }
 *     responses:
 *       200:
 *         description: Liste paginée des entrées d'historique, tous utilisateurs
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
 *                       id:                { type: integer }
 *                       action:            { type: string, enum: [create, update, delete] }
 *                       absence_id:        { type: integer }
 *                       user_id:           { type: integer }
 *                       utilisateur:       { type: string, nullable: true, description: Nom de l'utilisateur concerné }
 *                       utilisateur_email: { type: string, nullable: true }
 *                       auteur_id:         { type: integer, nullable: true }
 *                       auteur:            { type: string, nullable: true, description: Nom de l'auteur figé au moment de l'action }
 *                       auteur_nom:        { type: string, nullable: true, description: Nom courant de l'auteur }
 *                       date:              { type: string, format: date, nullable: true }
 *                       type:              { type: string, nullable: true }
 *                       valeur:            { type: number, nullable: true }
 *                       avant:             { type: object, nullable: true }
 *                       apres:             { type: object, nullable: true }
 *                       ip:                { type: string, nullable: true }
 *                       dateheure:         { type: string, format: date-time }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Réservé aux ultra admins
 */
router.get('/historique/tous', handleResponse(async (req, res) => {
  if (!isUltraAdminRequest(req)) {
    res.status(403);
    throw new Error('Réservé aux administrateurs');
  }

  const { search, userId, auteurId, action, type, absenceId, from, to, sort, order } = req.query;
  return await listAbsencesHistorique({
    userId: userId !== undefined ? parseInt(userId, 10) : null,
    auteurId: auteurId !== undefined ? parseInt(auteurId, 10) : null,
    action: action || null,
    type: type || null,
    absenceId: absenceId !== undefined ? parseInt(absenceId, 10) : null,
    dateFrom: from || null,
    dateTo: to || null,
    search: search || null,
    sort,
    order,
  });
}));

export default router;
