import express from 'express';
import {
  CRENEAUX, JOURS,
  createEndroit, deleteEndroit, getEndroit, getEndroits,
  heuresDebutFin, setIpEcran, typesEndroits, updateEndroit,
} from '../inc/office/endroits.js';
import {
  disponibilites, endroitDisponible, findConflits, listReservations, normaliserHeure,
} from '../inc/office/reservations.js';
import { planningEndroit } from '../inc/office/planning.js';
import { isAdminRequest, resolveAuteur } from '../inc/core/access.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/endroits';

const vrai = (v) => ['1', 'true', 'yes', 'oui'].includes(String(v).toLowerCase());

/** Endroit ciblé par la route (id numérique ou slug), ou 404 `endroit_inconnu`. */
async function endroitCible(idOrSlug) {
  const endroit = await getEndroit(idOrSlug);
  if (!endroit) throw httpError(404, 'endroit_inconnu', 'Endroit inconnu.');
  return endroit;
}

/** Les écritures sur le référentiel sont réservées aux admins (ou à un jeton applicatif). */
function assertAdmin(req) {
  if (!isAdminRequest(req)) {
    throw httpError(403, 'non_habilite', "La gestion des endroits est réservée aux administrateurs.");
  }
}

/**
 * @openapi
 * /endroits:
 *   get:
 *     tags: [Endroits]
 *     summary: Liste des endroits réservables
 *     description: |
 *       Un « endroit » n'est pas forcément un lieu : salle de réunion, salle de
 *       montage, mais aussi matériel (cf. `GET /endroits/types`). La liste est
 *       triée comme dans sogest (`ordre` puis `libelle`) et exclut la corbeille.
 *
 *       Chaque endroit porte sa disponibilité **immédiate** (`disponible`),
 *       calculée en une requête pour toute la liste.
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [reunion, montage, materiel, autre] } }
 *       - { in: query, name: equipeId, schema: { type: integer }, description: "Endroits réservés à une équipe" }
 *       - { in: query, name: ouverts, schema: { type: boolean }, description: "Si vrai, masque les endroits fermés à la réservation" }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des endroits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Endroit' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req) => {
  const endroits = await getEndroits({
    type: req.query.type || null,
    all: !vrai(req.query.ouverts),
    equipeId: req.query.equipeId ? parseInt(req.query.equipeId, 10) : null,
  });

  const libres = await disponibilites(endroits.map((e) => e.id));
  return endroits.map((e) => ({ ...e, disponible: e.ferme ? false : libres.get(e.id) !== false }));
}));

/**
 * @openapi
 * /endroits/types:
 *   get:
 *     tags: [Endroits]
 *     summary: Types d'endroits (salles de réunion, montage, matériel…)
 *     responses:
 *       200:
 *         description: Liste des types
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
 *                       slug:    { type: string }
 *                       libelle: { type: string }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/types', handleResponse(async () => typesEndroits()));

/**
 * @openapi
 * /endroits/grille:
 *   get:
 *     tags: [Endroits]
 *     summary: Grille de réservation (jours, heures, créneaux)
 *     description: |
 *       Les constantes d'affichage communes à tous les endroits : jours ouvrés,
 *       pas de 30 minutes de 08:00 à 21:00, et créneaux « en un clic »
 *       (matinée, après-midi, journée) acceptés par `POST /reservations`.
 *     responses:
 *       200:
 *         description: Grille de réservation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jours:    { type: array, items: { type: object } }
 *                 heures:   { type: array, items: { type: object } }
 *                 creneaux: { type: array, items: { type: object } }
 *                 types:    { type: array, items: { type: object } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/grille', handleResponse(async () => ({
  jours: JOURS,
  heures: heuresDebutFin(),
  creneaux: CRENEAUX,
  types: typesEndroits(),
})));

/**
 * @openapi
 * /endroits:
 *   post:
 *     tags: [Endroits]
 *     summary: Crée un endroit réservable
 *     description: Réservé aux administrateurs (ou à un jeton applicatif statique).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/EndroitEcriture' }
 *     responses:
 *       201: { description: Endroit créé, content: { application/json: { schema: { $ref: '#/components/schemas/Endroit' } } } }
 *       400: { description: "`libelle_requis` ou `type_inconnu`" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite`" }
 */
router.post('/', handleResponse(async (req, res) => {
  assertAdmin(req);
  let endroit;
  try {
    endroit = await createEndroit(req.body || {});
  } catch (err) {
    if (err.code === 'libelle_requis' || err.code === 'type_inconnu') {
      throw httpError(400, err.code, err.message);
    }
    throw err;
  }
  res.status(201);
  return endroit;
}));

/**
 * @openapi
 * /endroits/{id}:
 *   get:
 *     tags: [Endroits]
 *     summary: Détails d'un endroit
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string }, description: "Identifiant numérique ou slug" }
 *     responses:
 *       200: { description: Endroit, content: { application/json: { schema: { $ref: '#/components/schemas/Endroit' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`endroit_inconnu`" }
 */
router.get('/:id', handleResponse(async (req) => {
  const endroit = await endroitCible(req.params.id);
  return {
    ...endroit,
    disponible: endroit.ferme ? false : await endroitDisponible(endroit.id),
  };
}));

/**
 * @openapi
 * /endroits/{id}:
 *   put:
 *     tags: [Endroits]
 *     summary: Modifie un endroit
 *     description: |
 *       Réservé aux administrateurs. Seuls les champs fournis sont écrits, et
 *       l'état précédent est versionné dans `historique` (table `endroits`).
 *
 *       Fermer un endroit (`ferme: true`) le retire de la réservation sans
 *       toucher aux réservations déjà posées ; `message_ferme` explique pourquoi.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/EndroitEcriture' }
 *     responses:
 *       200: { description: Endroit mis à jour, content: { application/json: { schema: { $ref: '#/components/schemas/Endroit' } } } }
 *       400: { description: "`type_inconnu`" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite`" }
 *       404: { description: "`endroit_inconnu`" }
 */
router.put('/:id', handleResponse(async (req) => {
  assertAdmin(req);
  const endroit = await endroitCible(req.params.id);
  try {
    return await updateEndroit(endroit.id, req.body || {}, { auteur: await resolveAuteur(req) });
  } catch (err) {
    if (err.code === 'type_inconnu') throw httpError(400, err.code, err.message);
    throw err;
  }
}));

/**
 * @openapi
 * /endroits/{id}:
 *   delete:
 *     tags: [Endroits]
 *     summary: Met un endroit à la corbeille
 *     description: |
 *       Suppression douce (`trash = 1`), comme sogest : l'endroit disparaît des
 *       listes mais les réservations passées restent consultables.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted: { type: boolean }
 *                 id:      { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite`" }
 *       404: { description: "`endroit_inconnu`" }
 */
router.delete('/:id', handleResponse(async (req) => {
  assertAdmin(req);
  const endroit = await endroitCible(req.params.id);
  await deleteEndroit(endroit.id, { auteur: await resolveAuteur(req) });
  return { deleted: true, id: endroit.id };
}));

/**
 * @openapi
 * /endroits/{id}/planning:
 *   get:
 *     tags: [Endroits]
 *     summary: Planning hebdomadaire d'un endroit
 *     description: |
 *       Tout ce qu'il faut pour dessiner la semaine : les cinq jours ouvrés
 *       datés, la grille horaire, les créneaux « en un clic », la navigation
 *       d'une semaine à l'autre, et les réservations de la période.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: semaine, schema: { type: integer }, description: "Semaine ISO ; défaut : semaine courante" }
 *       - { in: query, name: annee,   schema: { type: integer }, description: "Défaut : année courante" }
 *     responses:
 *       200:
 *         description: Planning de la semaine
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 endroit_id:   { type: integer }
 *                 semaine:      { type: object }
 *                 jours:        { type: array, items: { type: object } }
 *                 heures:       { type: array, items: { type: object } }
 *                 creneaux:     { type: array, items: { type: object } }
 *                 reservations: { type: array, items: { $ref: '#/components/schemas/Reservation' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`endroit_inconnu`" }
 */
router.get('/:id/planning', handleResponse(async (req) => {
  const endroit = await endroitCible(req.params.id);
  return await planningEndroit(endroit, {
    semaine: req.query.semaine ? parseInt(req.query.semaine, 10) : null,
    annee: req.query.annee ? parseInt(req.query.annee, 10) : null,
  });
}));

/**
 * @openapi
 * /endroits/{id}/reservations:
 *   get:
 *     tags: [Endroits]
 *     summary: Réservations d'un endroit
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: jour, schema: { type: string, format: date } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to,   schema: { type: string, format: date } }
 *       - { in: query, name: aVenir, schema: { type: boolean }, description: "Seulement à partir d'aujourd'hui" }
 *       - { in: query, name: grouper, schema: { type: boolean }, description: "Fusionne les créneaux consécutifs d'un même utilisateur" }
 *     responses:
 *       200:
 *         description: Liste paginée des réservations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { $ref: '#/components/schemas/Reservation' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`endroit_inconnu`" }
 */
router.get('/:id/reservations', handleResponse(async (req) => {
  const endroit = await endroitCible(req.params.id);
  return await listReservations({
    endroitId: endroit.id,
    jour: req.query.jour || null,
    from: req.query.from || null,
    to: req.query.to || null,
    aVenir: vrai(req.query.aVenir),
    grouper: vrai(req.query.grouper),
  });
}));

/**
 * @openapi
 * /endroits/{id}/disponibilite:
 *   get:
 *     tags: [Endroits]
 *     summary: Un endroit est-il libre à cet instant / sur ce créneau ?
 *     description: |
 *       Sans paramètre, répond pour maintenant (c'est ce qu'affiche la pastille
 *       « Disponible / Occupée »). Avec `jour` et `debut`, répond pour ce
 *       moment-là ; `fin` teste toute une plage et renvoie les réservations
 *       qui la bloquent.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: jour,  schema: { type: string, format: date } }
 *       - { in: query, name: debut, schema: { type: string, example: "14:00" } }
 *       - { in: query, name: fin,   schema: { type: string, example: "15:30" } }
 *     responses:
 *       200:
 *         description: Disponibilité
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 endroit_id:  { type: integer }
 *                 disponible:  { type: boolean }
 *                 ferme:       { type: boolean }
 *                 conflits:    { type: array, items: { $ref: '#/components/schemas/Reservation' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`endroit_inconnu`" }
 */
router.get('/:id/disponibilite', handleResponse(async (req) => {
  const endroit = await endroitCible(req.params.id);
  const { jour, debut, fin } = req.query;

  if (fin) {
    const conflits = await findConflits(
      endroit.id,
      jour || new Date().toISOString().slice(0, 10),
      normaliserHeure(debut) || '00:00',
      normaliserHeure(fin)
    );
    return { endroit_id: endroit.id, ferme: endroit.ferme, disponible: !endroit.ferme && !conflits.length, conflits };
  }

  const disponible = !endroit.ferme && await endroitDisponible(endroit.id, jour || null, debut || null);
  return { endroit_id: endroit.id, ferme: endroit.ferme, disponible, conflits: [] };
}));

/**
 * @openapi
 * /endroits/{id}/ecran:
 *   put:
 *     tags: [Endroits]
 *     summary: Enregistre l'IP de l'écran posé devant un endroit
 *     description: |
 *       Les écrans e-ink installés devant les salles s'annoncent eux-mêmes
 *       (pendant de `endroit.php?slug=…&ip=…` en legacy). L'image affichée
 *       reste générée par sogest ; l'endroit en porte l'URL (`ecran`).
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ip]
 *             properties:
 *               ip: { type: string }
 *     responses:
 *       200: { description: Endroit mis à jour, content: { application/json: { schema: { $ref: '#/components/schemas/Endroit' } } } }
 *       400: { description: "`requete_invalide` — `ip` absente" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`endroit_inconnu`" }
 */
router.put('/:id/ecran', handleResponse(async (req) => {
  const endroit = await endroitCible(req.params.id);
  const ip = (req.body?.ip || '').trim();
  if (!ip) throw httpError(400, 'requete_invalide', 'Le champ `ip` est obligatoire.');
  return await setIpEcran(endroit.id, ip);
}));

export default router;
