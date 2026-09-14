import express from 'express';
import {
  listActivites, getActivite, getActiviteBrute, userCanAccessActivite,
  createActivite, updateActivite, trashActivite,
} from '../inc/editorial/activites.js';
import { isAdminRequest, resolveAuteur } from '../inc/core/access.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/activites';

/**
 * @openapi
 * /activites:
 *   get:
 *     tags: [Activités]
 *     summary: Liste des activités sélectionnables
 *     description: |
 *       Activités hors corbeille et non indisponibles, triées par période
 *       décroissante (plus récentes d'abord) par défaut.
 *
 *       **Périmètre** : un admin (JWT `level=admin`/`ultra_admin`, ou token
 *       statique) voit toutes les activités. Un utilisateur standard ne voit que
 *       les activités ayant au moins une pige liée à son `personne_id`, ou qu'il
 *       a lui-même créées.
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [libelle, id, periode, numero], default: periode }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: s, schema: { type: string }, description: "Recherche plein-texte (LIKE) sur le libellé" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des activités
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
  const { sort, order, s } = req.query;
  const search = s || null;
  if (isAdminRequest(req)) {
    return await listActivites({ sort, order, search });
  }
  return await listActivites({
    sort,
    order,
    search,
    personneId: req.user?.personne_id ?? 0,
    userId: req.user?.id ?? 0,
  });
}));

/**
 * @openapi
 * /activites/{id}:
 *   get:
 *     tags: [Activités]
 *     summary: Détail d'une activité
 *     description: |
 *       Un utilisateur standard ne peut accéder qu'aux activités sur lesquelles il
 *       a une pige, ou qu'il a créées (sinon `403`). Les admins / token statique
 *       accèdent à tout.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données de l'activité, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Activité hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const activite = await getActivite(id);
  if (!activite) {
    res.status(404);
    throw new Error('Activite not found');
  }
  if (!isAdminRequest(req) && !(await userCanAccessActivite(req.user?.personne_id ?? 0, req.user?.id ?? 0, id))) {
    res.status(403);
    throw new Error('Activité hors de votre périmètre');
  }
  return activite;
}));

/**
 * Charge l'activité visée par une écriture et vérifie que la requête a le droit
 * de la modifier : admin (JWT `level=admin`/`ultra_admin`, ou jeton statique),
 * ou l'utilisateur qui l'a créée. Avoir une pige dessus ne suffit pas : cela
 * donne accès en lecture, pas la main sur les données de base.
 *
 * Contrairement à `GET /activites/{id}`, une activité archivée
 * (`indisponible`) reste modifiable — c'est ainsi qu'on la désarchive.
 *
 * @param {import('express').Request} req
 * @returns {Promise<Object>}
 * @throws activité inconnue (404) ou hors périmètre (403)
 */
async function activitePourEcriture(req) {
  const id = parseInt(req.params.id, 10);
  const activite = await getActiviteBrute(id);
  if (!activite) throw httpError(404, 'activite_inconnue', 'Activité introuvable');

  if (!isAdminRequest(req) && Number(activite.createur_id) !== Number(req.user?.id ?? 0)) {
    throw httpError(403, 'non_habilite', 'Activité hors de votre périmètre');
  }

  return activite;
}

/**
 * @openapi
 * /activites:
 *   post:
 *     tags: [Activités]
 *     summary: Crée une activité
 *     description: |
 *       Crée une activité sur ses **données de base** uniquement : la saisie des
 *       piges (`piges`, `total`), le workflow de clôture (`cloture`, `okredac`),
 *       le blocage et la fusion de doublons restent du ressort de sogest et ne
 *       sont pas écrits par l'API.
 *
 *       `support` (le nom) et `libelle` sont dérivés du support et des champs
 *       fournis, exactement comme sogest les calcule — ils ne se posent pas.
 *
 *       Sous jeton statique, l'auteur peut être désigné via `auteur_user_id`
 *       (corps) ou l'en-tête `X-Auteur-User-Id` (id `users` ou `sub` SSO).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [support_id]
 *             properties:
 *               support_id:      { type: integer }
 *               edition_id:      { type: integer, nullable: true }
 *               numero:          { type: integer, nullable: true }
 *               periode:         { type: string, description: "Ex. « janvier 2026 » ; alternative à numero" }
 *               projet:          { type: string }
 *               version:         { type: string }
 *               categorie:       { type: string, nullable: true }
 *               support_mag:     { type: integer, enum: [0, 1], description: "Supplément d'un magazine" }
 *               date_bouclage:   { type: string, format: date }
 *               description:     { type: string }
 *               liens:           { type: string }
 *               public:          { type: integer, enum: [0, 1] }
 *               indisponible:    { type: integer, enum: [0, 1], description: "Activité archivée" }
 *               auteur_user_id:  { type: string, nullable: true, description: "Auteur de la création (jeton statique uniquement)" }
 *     responses:
 *       201: { description: Activité créée, content: { application/json: { schema: { type: object } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/', handleResponse(async (req, res) => {
  let activite;
  try {
    activite = await createActivite(req.body || {}, await resolveAuteur(req));
  } catch (err) {
    if (err.code === 'support_inconnu') throw httpError(400, err.code, err.message);
    throw err;
  }
  res.status(201);
  return activite;
}));

/**
 * @openapi
 * /activites/{id}:
 *   put:
 *     tags: [Activités]
 *     summary: Met à jour les données de base d'une activité
 *     description: |
 *       Mise à jour partielle : seuls les champs fournis sont écrits, et seuls
 *       ceux listés ci-dessous sont acceptés (mêmes exclusions que `POST
 *       /activites` : piges, clôture, blocage, fusion).
 *
 *       Le `libelle` est recalculé à chaque écriture. Basculer `indisponible`
 *       archive (ou désarchive) l'activité et masque (ou réaffiche) ses piges,
 *       comme le fait sogest.
 *
 *       **Périmètre** : admin / jeton statique, ou le créateur de l'activité.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               support_id:      { type: integer }
 *               edition_id:      { type: integer, nullable: true }
 *               numero:          { type: integer, nullable: true }
 *               periode:         { type: string }
 *               projet:          { type: string }
 *               version:         { type: string }
 *               categorie:       { type: string, nullable: true }
 *               support_mag:     { type: integer, enum: [0, 1] }
 *               date_bouclage:   { type: string, format: date }
 *               description:     { type: string }
 *               liens:           { type: string }
 *               public:          { type: integer, enum: [0, 1] }
 *               indisponible:    { type: integer, enum: [0, 1] }
 *               auteur_user_id:  { type: string, nullable: true, description: "Auteur de la modification (jeton statique uniquement)" }
 *     responses:
 *       200: { description: Activité à jour, content: { application/json: { schema: { type: object } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Activité hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', handleResponse(async (req) => {
  const activite = await activitePourEcriture(req);
  try {
    return await updateActivite(activite.id, req.body || {}, await resolveAuteur(req));
  } catch (err) {
    if (err.code === 'support_inconnu' || err.code === 'aucun_champ') {
      throw httpError(400, err.code, err.message);
    }
    throw err;
  }
}));

/**
 * @openapi
 * /activites/{id}:
 *   delete:
 *     tags: [Activités]
 *     summary: Met une activité à la corbeille
 *     description: |
 *       Suppression logique (`trash`), comme dans sogest : l'activité et ses
 *       piges passent en corbeille, rien n'est effacé en base. L'état précédent
 *       est enregistré dans l'historique.
 *
 *       **Périmètre** : admin / jeton statique, ou le créateur de l'activité.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Activité mise à la corbeille
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:      { type: integer }
 *                 trash:   { type: boolean }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Activité hors du périmètre de l'utilisateur }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', handleResponse(async (req) => {
  const activite = await activitePourEcriture(req);
  await trashActivite(activite.id, await resolveAuteur(req));
  return { id: activite.id, trash: true };
}));

export default router;
