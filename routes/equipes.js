import express from 'express';
import {
  addMembreEquipe, getEquipe, getEquipeBySlug, getEquipes, getEquipesByUserId,
  getLienEquipeUser, getMembresEquipe, isUserInEquipe, removeMembreEquipe,
} from '../inc/rh/equipes.js';
import { getUser } from '../inc/rh/users.js';
import { handleResponse, httpError } from '../inc/core/response.js';
import { isAdminRequest, isEquipeInTokenScope } from '../inc/core/access.js';

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
 * Résout l'auteur d'une écriture sur les membres.
 *
 * - JWT : l'utilisateur du token, sans discussion.
 * - Jeton applicatif statique : l'appelant peut désigner la personne connectée
 *   de son côté via `auteur_user_id` (corps) ou l'en-tête `X-Auteur-User-Id`.
 *   La valeur accepte l'id `users` sogest ou le `sub` SSO `spc-sogest_{id}`.
 *
 * Un auteur inconnu n'est pas une erreur : l'écriture est simplement tracée
 * sans auteur nommé.
 *
 * @param {import('express').Request} req
 * @returns {Promise<Object|null>}
 */
async function resolveAuteur(req) {
  if (req.user) return req.user;

  const raw = req.body?.auteur_user_id ?? req.headers['x-auteur-user-id'];
  if (raw === undefined || raw === null || raw === '') return null;

  const id = parseInt(String(raw).replace(/^spc-sogest_/, ''), 10);
  if (isNaN(id)) return null;

  return (await getUser(id)) || null;
}

/**
 * Vérifie que la requête a le droit de modifier la composition de cette équipe.
 *
 * - jeton applicatif statique : autorisé, dans la limite du périmètre déclaré
 *   pour ce jeton (`tokenScopes` dans config.json) ;
 * - JWT admin / ultra admin : autorisé ;
 * - JWT lambda : uniquement s'il est `manager` de l'équipe visée.
 *
 * @param {import('express').Request} req
 * @param {Object} equipe
 */
async function assertPeutGererMembres(req, equipe) {
  if (isAdminRequest(req)) {
    if (!isEquipeInTokenScope(req, equipe.id)) {
      throw httpError(403, 'non_habilite', "Ce jeton n'a pas le droit d'écrire sur cette équipe.");
    }
    return;
  }

  const lien = req.user ? await getLienEquipeUser(equipe.id, req.user.id) : null;
  if (lien?.role !== 'manager') {
    throw httpError(403, 'non_habilite', "Vous n'êtes pas habilité à gérer les membres de cette équipe.");
  }
}

/** Équipe ciblée par la route, ou 404 `equipe_inconnue`. */
async function equipeCiblee(idOrSlug) {
  const equipe = await getEquipe(idOrSlug);
  if (!equipe) throw httpError(404, 'equipe_inconnue', 'Équipe inconnue.');
  return equipe;
}

/**
 * @openapi
 * /equipes/{id}/membres:
 *   post:
 *     tags: [Equipes]
 *     summary: Ajoute un membre à une équipe
 *     description: |
 *       Rattache un utilisateur existant à l'équipe. Aucun compte n'est créé :
 *       un `user_id` sans compte actif renvoie **404 `utilisateur_inconnu`**.
 *
 *       **Habilitation** : jeton applicatif statique (dans la limite du
 *       périmètre déclaré pour ce jeton, cf. `tokenScopes` dans `config.json`),
 *       JWT admin, ou JWT d'un `manager` de l'équipe visée.
 *
 *       **Auteur** : sous JWT, l'auteur tracé est l'utilisateur du token. Sous
 *       jeton statique, l'appelant peut le désigner via `auteur_user_id` (ou
 *       l'en-tête `X-Auteur-User-Id`) ; l'id `users` sogest comme le `sub` SSO
 *       `spc-sogest_{id}` sont acceptés.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identifiant numérique ou slug de l'équipe
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id]
 *             properties:
 *               user_id:        { type: integer, description: "Identifiant `users` sogest" }
 *               role:           { type: string, nullable: true, description: "Rôle dans l'équipe (`manager` ou vide)" }
 *               auteur_user_id: { type: string, nullable: true, description: "Auteur de la modification (jeton statique uniquement)" }
 *     responses:
 *       201:
 *         description: Membre ajouté, au format d'une ligne de `GET /equipes/{id}/membres`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:            { type: integer }
 *                 nom:           { type: string }
 *                 prenom:        { type: string }
 *                 email:         { type: string }
 *                 role:          { type: string, nullable: true }
 *                 membre_depuis: { type: string, format: date-time, nullable: true }
 *       400: { description: "`requete_invalide` — `user_id` absent ou non numérique" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite` — jeton valide mais sans droit sur cette équipe" }
 *       404: { description: "`equipe_inconnue` ou `utilisateur_inconnu`" }
 *       409: { description: "`membre_existant` — la personne est déjà membre" }
 */
router.post('/:equipeId/membres', handleResponse(async (req, res) => {
  const equipe = await equipeCiblee(req.params.equipeId);
  await assertPeutGererMembres(req, equipe);

  const userId = parseInt(req.body?.user_id, 10);
  if (!userId || isNaN(userId)) {
    throw httpError(400, 'requete_invalide', 'Le champ `user_id` est obligatoire et doit être numérique.');
  }

  // getUser() filtre les comptes en corbeille / inactifs : pas de rattachement
  // orphelin ou vers un compte fermé.
  const user = await getUser(userId);
  if (!user) {
    throw httpError(404, 'utilisateur_inconnu', 'Aucun compte actif ne correspond à ce `user_id`.');
  }

  const role = req.body?.role ?? null;
  if (role !== null && typeof role !== 'string') {
    throw httpError(400, 'requete_invalide', 'Le champ `role` doit être une chaîne ou `null`.');
  }

  let membre;
  try {
    membre = await addMembreEquipe(equipe.id, userId, { role, auteur: await resolveAuteur(req) });
  } catch (err) {
    if (err.code === 'membre_existant') {
      throw httpError(409, 'membre_existant', 'Cette personne est déjà membre de l\'équipe.');
    }
    throw err;
  }

  res.status(201);
  return membre;
}));

/**
 * @openapi
 * /equipes/{id}/membres/{userId}:
 *   delete:
 *     tags: [Equipes]
 *     summary: Retire un membre d'une équipe
 *     description: |
 *       Supprime le **rattachement** : le compte sogest de la personne reste
 *       intact. Retirer quelqu'un qui n'est pas membre renvoie **404
 *       `membre_inconnu`** (et non un 204 optimiste), pour qu'un écran affichant
 *       une liste périmée puisse le signaler.
 *
 *       Même habilitation et même traçage de l'auteur que `POST
 *       /equipes/{id}/membres` (en-tête `X-Auteur-User-Id` sous jeton statique).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identifiant numérique ou slug de l'équipe
 *         schema: { type: string }
 *       - { in: path, name: userId, required: true, schema: { type: integer } }
 *     responses:
 *       204: { description: Membre retiré (sans corps) }
 *       400: { description: "`requete_invalide` — `userId` non numérique" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite` — jeton valide mais sans droit sur cette équipe" }
 *       404: { description: "`equipe_inconnue` ou `membre_inconnu`" }
 */
router.delete('/:equipeId/membres/:userId', handleResponse(async (req, res) => {
  const equipe = await equipeCiblee(req.params.equipeId);
  await assertPeutGererMembres(req, equipe);

  const userId = parseInt(req.params.userId, 10);
  if (!userId || isNaN(userId)) {
    throw httpError(400, 'requete_invalide', 'Le `userId` doit être numérique.');
  }

  const retire = await removeMembreEquipe(equipe.id, userId, { auteur: await resolveAuteur(req) });
  if (!retire) {
    throw httpError(404, 'membre_inconnu', "Cette personne n'est pas membre de l'équipe.");
  }

  res.status(204).end();
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
