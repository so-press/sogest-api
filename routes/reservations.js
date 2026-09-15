import express from 'express';
import dayjs from 'dayjs';
import {
  createReservation, deleteReservation, findConflits, getReservation,
  listReservations, resoudrePlage, updateReservation,
} from '../inc/office/reservations.js';
import { getEndroit } from '../inc/office/endroits.js';
import { isAdminRequest, isUltraAdminRequest, resolveAuteur } from '../inc/core/access.js';
import { isUserInEquipe } from '../inc/rh/equipes.js';
import { getUser } from '../inc/rh/users.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/reservations';

const vrai = (v) => ['1', 'true', 'yes', 'oui'].includes(String(v).toLowerCase());

/**
 * Utilisateur pour le compte de qui la requête agit.
 *
 * Sous JWT c'est l'utilisateur du token. Sous jeton applicatif statique
 * (sogest, l'appli « the office »), l'appelant doit désigner la personne
 * connectée de son côté via `auteur_user_id` ou l'en-tête `X-Auteur-User-Id` :
 * une réservation appartient toujours à quelqu'un.
 */
async function utilisateurCourant(req) {
  const user = await resolveAuteur(req);
  if (!user) {
    throw httpError(401, 'utilisateur_requis',
      "Impossible de déterminer l'utilisateur : fournissez un JWT, ou `auteur_user_id` / l'en-tête `X-Auteur-User-Id` avec un jeton applicatif.");
  }
  return user;
}

/**
 * Titulaire de la réservation : soi-même, ou quelqu'un d'autre si on en a le
 * droit (admin — c'est la règle de sogest, « réserver pour un collègue »).
 */
async function titulaire(req, courant) {
  const demande = req.body?.user_id;
  if (demande === undefined || demande === null || demande === '' || Number(demande) === courant.id) {
    return courant;
  }
  if (!isAdminRequest(req)) {
    throw httpError(403, 'non_habilite', "Seul un administrateur peut réserver au nom de quelqu'un d'autre.");
  }
  const user = await getUser(parseInt(demande, 10));
  if (!user) throw httpError(404, 'utilisateur_inconnu', 'Aucun compte actif ne correspond à ce `user_id`.');
  return user;
}

/** Endroit ciblé, ou 404 `endroit_inconnu`. */
async function endroitCible(idOrSlug) {
  const endroit = await getEndroit(idOrSlug);
  if (!endroit) throw httpError(404, 'endroit_inconnu', 'Endroit inconnu.');
  return endroit;
}

/**
 * Vérifie qu'un endroit est réservable par cet utilisateur : ouvert, et — s'il
 * est rattaché à une équipe — réservé aux membres de cette équipe (les ultra
 * admins passent outre, comme `User::verifierEquipes()` en legacy).
 */
async function assertReservable(req, endroit, user) {
  if (endroit.ferme) {
    throw httpError(409, 'endroit_ferme', endroit.message_ferme || 'Cet endroit est fermé à la réservation.');
  }
  if (!endroit.id_equipe) return;
  if (isUltraAdminRequest(req)) return;
  if (await isUserInEquipe(user.id, endroit.id_equipe)) return;

  throw httpError(403, 'equipe_requise',
    `La réservation est réservée aux membres de l'équipe « ${endroit.equipe} ».`);
}

/** Jour valide au format YYYY-MM-DD. */
function jourValide(jour) {
  if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(String(jour)) || !dayjs(jour).isValid()) {
    throw httpError(400, 'requete_invalide', 'Le champ `jour` est obligatoire (format YYYY-MM-DD).');
  }
  return jour;
}

/** Traduit les erreurs de plage horaire du helper en erreurs HTTP. */
function plage(data) {
  try {
    return resoudrePlage(data);
  } catch (err) {
    if (err.code) throw httpError(400, err.code, err.message);
    throw err;
  }
}

/** Réservation modifiable par l'appelant : son titulaire, ou un admin. */
function assertPeutModifier(req, reservation, courant) {
  if (reservation.user_id === courant.id) return;
  if (isAdminRequest(req)) return;
  throw httpError(403, 'non_habilite', "Cette réservation ne vous appartient pas.");
}

/**
 * @openapi
 * /reservations:
 *   get:
 *     tags: [Réservations]
 *     summary: Liste des réservations
 *     description: |
 *       Filtrable par endroit, par utilisateur et par période. Sans filtre de
 *       date, renvoie tout l'historique : pensez à `aVenir=1` ou à `from`/`to`.
 *     parameters:
 *       - { in: query, name: endroitId, schema: { type: string }, description: "Identifiant ou slug de l'endroit" }
 *       - { in: query, name: userId,    schema: { type: integer } }
 *       - { in: query, name: moi,       schema: { type: boolean }, description: "Mes propres réservations" }
 *       - { in: query, name: jour,      schema: { type: string, format: date } }
 *       - { in: query, name: from,      schema: { type: string, format: date } }
 *       - { in: query, name: to,        schema: { type: string, format: date } }
 *       - { in: query, name: aVenir,    schema: { type: boolean } }
 *       - { in: query, name: grouper,   schema: { type: boolean }, description: "Fusionne les créneaux consécutifs d'un même utilisateur" }
 *       - { in: query, name: page,      schema: { type: integer } }
 *       - { in: query, name: limit,     schema: { type: integer, default: 50 } }
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
 */
router.get('/', handleResponse(async (req) => {
  let userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  if (vrai(req.query.moi)) userId = (await utilisateurCourant(req)).id;

  let endroitId = null;
  if (req.query.endroitId) endroitId = (await endroitCible(req.query.endroitId)).id;

  return await listReservations({
    endroitId,
    userId,
    jour: req.query.jour || null,
    from: req.query.from || null,
    to: req.query.to || null,
    aVenir: vrai(req.query.aVenir),
    grouper: vrai(req.query.grouper),
  });
}));

/**
 * @openapi
 * /reservations/{id}:
 *   get:
 *     tags: [Réservations]
 *     summary: Détails d'une réservation
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Réservation, content: { application/json: { schema: { $ref: '#/components/schemas/Reservation' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: "`reservation_inconnue`" }
 */
router.get('/:id', handleResponse(async (req) => {
  const reservation = await getReservation(parseInt(req.params.id, 10));
  if (!reservation) throw httpError(404, 'reservation_inconnue', 'Réservation inconnue.');
  return reservation;
}));

/**
 * @openapi
 * /reservations:
 *   post:
 *     tags: [Réservations]
 *     summary: Réserve un endroit
 *     description: |
 *       La plage se donne au choix : `fin`, `duree` (`01:30`) ou `creneau`
 *       (`matin`, `apres-midi`, `journee`, cf. `GET /endroits/grille`).
 *
 *       Le chevauchement est refusé (**409 `creneau_occupe`**, avec les
 *       réservations en cause) ; deux créneaux qui se touchent (10:30 → 11:00
 *       puis 11:00 → 11:30) ne se gênent pas.
 *
 *       Un endroit rattaché à une équipe n'est réservable que par ses membres,
 *       et un endroit fermé ne l'est par personne. Réserver **au nom d'un
 *       autre** (`user_id`) demande d'être administrateur.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endroit_id, jour, debut]
 *             properties:
 *               endroit_id: { type: string, description: "Identifiant ou slug de l'endroit" }
 *               jour:       { type: string, format: date }
 *               debut:      { type: string, example: "14:00" }
 *               fin:        { type: string, example: "15:30" }
 *               duree:      { type: string, example: "01:30", description: "Alternative à `fin`" }
 *               creneau:    { type: string, enum: [matin, apres-midi, journee], description: "Alternative à `debut`/`fin`" }
 *               objet:      { type: string, description: "Facultatif, affiché à la place du nom" }
 *               user_id:    { type: integer, description: "Réserver au nom d'un autre (admins)" }
 *               auteur_user_id: { type: integer, description: "Utilisateur agissant (jeton applicatif statique uniquement)" }
 *     responses:
 *       201: { description: Réservation créée, content: { application/json: { schema: { $ref: '#/components/schemas/Reservation' } } } }
 *       400: { description: "`requete_invalide`, `plage_invalide` ou `creneau_inconnu`" }
 *       401: { description: "`utilisateur_requis` — jeton applicatif sans utilisateur désigné" }
 *       403: { description: "`equipe_requise` ou `non_habilite`" }
 *       404: { description: "`endroit_inconnu` ou `utilisateur_inconnu`" }
 *       409: { description: "`endroit_ferme` ou `creneau_occupe`" }
 */
router.post('/', handleResponse(async (req, res) => {
  const courant = await utilisateurCourant(req);
  const endroit = await endroitCible(req.body?.endroit_id);
  const user = await titulaire(req, courant);

  await assertReservable(req, endroit, user);

  const jour = jourValide(req.body?.jour);
  const { debut, fin } = plage(req.body);

  const conflits = await findConflits(endroit.id, jour, debut, fin);
  if (conflits.length) {
    throw httpError(409, 'creneau_occupe', 'Ce créneau est déjà réservé.', { conflits });
  }

  res.status(201);
  return await createReservation({
    endroit_id: endroit.id,
    user_id: user.id,
    jour,
    debut,
    fin,
    objet: req.body?.objet || '',
  });
}));

/**
 * @openapi
 * /reservations/{id}:
 *   put:
 *     tags: [Réservations]
 *     summary: Modifie une réservation
 *     description: |
 *       Déplacer une réservation (jour, plage) ou changer son objet. L'endroit,
 *       lui, n'est pas modifiable : annulez et reréservez. Réservé au titulaire
 *       de la réservation ou à un administrateur ; l'état précédent est
 *       versionné dans `historique`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jour:    { type: string, format: date }
 *               debut:   { type: string, example: "14:00" }
 *               fin:     { type: string, example: "15:30" }
 *               duree:   { type: string, example: "01:30" }
 *               creneau: { type: string, enum: [matin, apres-midi, journee] }
 *               objet:   { type: string }
 *               user_id: { type: integer, description: "Transférer à un autre utilisateur (admins)" }
 *     responses:
 *       200: { description: Réservation mise à jour, content: { application/json: { schema: { $ref: '#/components/schemas/Reservation' } } } }
 *       400: { description: "`requete_invalide` ou `plage_invalide`" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite`" }
 *       404: { description: "`reservation_inconnue`" }
 *       409: { description: "`creneau_occupe`" }
 */
router.put('/:id', handleResponse(async (req) => {
  const courant = await utilisateurCourant(req);
  const id = parseInt(req.params.id, 10);
  const reservation = await getReservation(id);
  if (!reservation) throw httpError(404, 'reservation_inconnue', 'Réservation inconnue.');
  assertPeutModifier(req, reservation, courant);

  const data = {};
  if (req.body?.objet !== undefined) data.objet = req.body.objet || '';
  if (req.body?.jour !== undefined) data.jour = jourValide(req.body.jour);
  if (req.body?.user_id !== undefined) data.user_id = (await titulaire(req, courant)).id;

  const changePlage = ['debut', 'fin', 'duree', 'creneau'].some((k) => req.body?.[k] !== undefined);
  if (changePlage) {
    const { debut, fin } = plage({ debut: reservation.debut, fin: null, ...req.body });
    data.debut = debut;
    data.fin = fin;
  }

  if (changePlage || data.jour) {
    const conflits = await findConflits(
      reservation.endroit_id,
      data.jour ?? reservation.jour,
      data.debut ?? reservation.debut,
      data.fin ?? reservation.fin,
      { exclureId: id }
    );
    if (conflits.length) {
      throw httpError(409, 'creneau_occupe', 'Ce créneau est déjà réservé.', { conflits });
    }
  }

  return await updateReservation(id, data, { auteur: courant });
}));

/**
 * @openapi
 * /reservations/{id}:
 *   delete:
 *     tags: [Réservations]
 *     summary: Annule une réservation
 *     description: |
 *       Mise à la corbeille (`trash = 1`), comme sogest : la réservation
 *       disparaît du planning mais reste en base. Réservé au titulaire ou à un
 *       administrateur.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
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
 *       404: { description: "`reservation_inconnue`" }
 */
router.delete('/:id', handleResponse(async (req) => {
  const courant = await utilisateurCourant(req);
  const id = parseInt(req.params.id, 10);
  const reservation = await getReservation(id);
  if (!reservation) throw httpError(404, 'reservation_inconnue', 'Réservation inconnue.');
  assertPeutModifier(req, reservation, courant);

  await deleteReservation(id, { auteur: courant });
  return { deleted: true, id };
}));

export default router;
