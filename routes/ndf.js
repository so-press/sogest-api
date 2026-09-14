import express from 'express';
import {
  listNdf,
  countNdfByEtat,
  getNdf,
  createNdf,
  updateNdf,
  deleteNdf,
  getDepenses,
  getDepense,
  createDepense,
  updateDepense,
  deleteDepense,
  marquerDetectionIa,
  ndfAppartientA,
  ndfEstEditable,
} from '../inc/ndf/ndf.js';
import { detecterDepuisJustificatif, champsAAppliquer } from '../inc/ndf/detection.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/ndf';
// Toutes les routes nécessitent un utilisateur connecté (JWT, pas un token statique)
export const requireAuth = true;

/**
 * Charge la ndf de `:id` et vérifie qu'elle appartient à l'utilisateur connecté.
 * Pose le statut HTTP et lève une erreur en cas d'absence (404) ou de non-propriété (403).
 */
async function loadOwnedNdf(req, res) {
  const id = parseInt(req.params.id, 10);
  const ndf = await getNdf(id);
  if (!ndf) {
    res.status(404);
    throw new Error('Ndf not found');
  }
  if (!ndfAppartientA(ndf, req.user)) {
    res.status(403);
    throw new Error('This ndf does not belong to the current user');
  }
  return ndf;
}

function assertEditable(ndf, res) {
  if (!ndfEstEditable(ndf)) {
    res.status(409);
    throw new Error(`Ndf saisie is locked (etat: ${ndf.etat})`);
  }
}

/**
 * @openapi
 * /ndf:
 *   get:
 *     tags: [Notes de frais]
 *     summary: Liste des notes de frais de l'utilisateur connecté
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: etat, schema: { type: string, enum: [brouillon, a-traiter, a-corriger, validee, payee, archivee, vide] } }
 *       - { in: query, name: cb, schema: { type: boolean }, description: Filtre sur les ndf rattachées à une carte bancaire }
 *       - { in: query, name: s, schema: { type: string }, description: "Recherche plein-texte (LIKE) sur les champs de la ndf et de ses dépenses" }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [modification, creation, periode, ttc, id], default: modification }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des notes de frais
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
  const { etat, cb, s, sort, order } = req.query;
  return await listNdf({
    userId: req.user.id,
    personneId: req.user.personne_id || null,
    etat: etat || null,
    cb: cb === undefined ? null : (cb !== '0' && cb !== 'false'),
    search: s || null,
    sort,
    order,
  });
}));

/**
 * @openapi
 * /ndf/counts:
 *   get:
 *     tags: [Notes de frais]
 *     summary: Nombre de notes de frais de l'utilisateur, groupées par état
 *     description: |
 *       Renvoie le décompte par état (hors corbeille) pour alimenter les
 *       compteurs des onglets de filtre du front. Doit être déclarée avant
 *       `/ndf/{id}` pour ne pas être capturée comme un identifiant.
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200:
 *         description: Décompte par état et total
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 counts: { type: object, additionalProperties: { type: integer }, example: { brouillon: 3, 'a-traiter': 1 } }
 *                 total:  { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/counts', handleResponse(async (req) => {
  return await countNdfByEtat({
    userId: req.user.id,
    personneId: req.user.personne_id || null,
  });
}));

/**
 * @openapi
 * /ndf:
 *   post:
 *     tags: [Notes de frais]
 *     summary: Crée une note de frais (état brouillon)
 *     description: La ndf est toujours rattachée à l'utilisateur du token JWT.
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               support_id:  { type: integer }
 *               periode:     { type: string, description: 'Mois concerné au format YYYY-MM (défaut : mois courant)' }
 *               devise:      { type: string, default: EUR }
 *               cb:          { type: boolean, description: Dépenses réglées par carte bancaire pro }
 *               nom_cb:      { type: string }
 *               projet:      { type: string, description: Libellé libre du projet }
 *               projet_type: { type: integer, enum: [1, 2, 3], description: '1=projet, 2=activité, 3=libre' }
 *               projet_id:   { type: integer, description: Renseigne le libellé depuis la table projets (projet_type=1) }
 *               activite_id: { type: integer, description: Renseigne le libellé depuis la table activités (projet_type=2) }
 *               remarque:    { type: string }
 *     responses:
 *       201: { description: Note de frais créée, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/', handleResponse(async (req, res) => {
  res.status(201);
  return await createNdf({ user: req.user, data: req.body || {} });
}));

/**
 * @openapi
 * /ndf/{id}:
 *   get:
 *     tags: [Notes de frais]
 *     summary: Détail d'une note de frais (dépenses incluses)
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données de la ndf et tableau `depenses`, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  await loadOwnedNdf(req, res);
  // getNdf charge les dépenses (reconversion EUR au taux à date) puis relit la
  // ndf : les totaux dénormalisés renvoyés sont donc à jour dès le premier appel.
  return await getNdf(parseInt(req.params.id, 10), { withDepenses: true });
}));

/**
 * @openapi
 * /ndf/{id}:
 *   put:
 *     tags: [Notes de frais]
 *     summary: Modifie une note de frais
 *     description: Un changement d'`etat` empile un événement dans la timeline.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               support_id:  { type: integer }
 *               periode:     { type: string }
 *               devise:      { type: string }
 *               cb:          { type: boolean }
 *               nom_cb:      { type: string }
 *               projet:      { type: string }
 *               projet_type: { type: integer, enum: [1, 2, 3] }
 *               projet_id:   { type: integer }
 *               activite_id: { type: integer }
 *               remarque:    { type: string }
 *               etat:        { type: string, enum: [brouillon, a-traiter, a-corriger, validee, payee, archivee, vide] }
 *     responses:
 *       200: { description: Note de frais mise à jour, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', handleResponse(async (req, res) => {
  await loadOwnedNdf(req, res);
  return await updateNdf(parseInt(req.params.id, 10), req.body || {}, req.user);
}));

/**
 * @openapi
 * /ndf/{id}:
 *   delete:
 *     tags: [Notes de frais]
 *     summary: Supprime (corbeille) une note de frais et ses dépenses
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
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', handleResponse(async (req, res) => {
  const ndf = await loadOwnedNdf(req, res);
  await deleteNdf(ndf.id);
  return { deleted: true, id: ndf.id };
}));

/**
 * @openapi
 * /ndf/{id}/depenses:
 *   get:
 *     tags: [Notes de frais]
 *     summary: Liste des dépenses d'une note de frais
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des dépenses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id/depenses', handleResponse(async (req, res) => {
  const ndf = await loadOwnedNdf(req, res);
  return await getDepenses(ndf.id);
}));

/**
 * @openapi
 * /ndf/{id}/depenses:
 *   post:
 *     tags: [Notes de frais]
 *     summary: Ajoute une dépense à une note de frais
 *     description: |
 *       Possible uniquement quand la ndf est modifiable (état brouillon ou
 *       a-corriger). Les totaux de la ndf sont recalculés automatiquement.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type_depense:    { type: string, description: 'deplacements, parking, taxi, carburant, location_voiture, hotel, telecom, restauration, autre' }
 *               date_depense:    { type: string, format: date }
 *               libelle:         { type: string }
 *               etablissement:   { type: string }
 *               ht:              { type: number }
 *               tva:             { type: number }
 *               ttc:             { type: number }
 *               devise:          { type: string }
 *               justificatif:    { type: string, description: URL du justificatif (upload géré via /upload) }
 *               support_id:      { type: integer }
 *               ordre:           { type: integer }
 *               immatriculation: { type: string, description: Pour carburant / location_voiture }
 *               type_vehicule:   { type: string, description: Pour carburant / location_voiture }
 *     responses:
 *       201: { description: Dépense créée, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: La saisie de la ndf est verrouillée (état non modifiable) }
 */
router.post('/:id/depenses', handleResponse(async (req, res) => {
  const ndf = await loadOwnedNdf(req, res);
  assertEditable(ndf, res);
  res.status(201);
  return await createDepense(ndf, req.body || {});
}));

/**
 * @openapi
 * /ndf/{id}/depenses/{depenseId}:
 *   put:
 *     tags: [Notes de frais]
 *     summary: Modifie une dépense d'une note de frais
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: depenseId, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type_depense:    { type: string }
 *               date_depense:    { type: string, format: date }
 *               libelle:         { type: string }
 *               etablissement:   { type: string }
 *               ht:              { type: number }
 *               tva:             { type: number }
 *               ttc:             { type: number }
 *               devise:          { type: string }
 *               justificatif:    { type: string }
 *               support_id:      { type: integer }
 *               ordre:           { type: integer }
 *               immatriculation: { type: string }
 *               type_vehicule:   { type: string }
 *     responses:
 *       200: { description: Dépense mise à jour, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: La saisie de la ndf est verrouillée (état non modifiable) }
 */
router.put('/:id/depenses/:depenseId', handleResponse(async (req, res) => {
  const ndf = await loadOwnedNdf(req, res);
  assertEditable(ndf, res);

  const depenseId = parseInt(req.params.depenseId, 10);
  const depense = await getDepense(depenseId);
  if (!depense || depense.ndf_id !== ndf.id) {
    res.status(404);
    throw new Error('Depense not found in this ndf');
  }
  return await updateDepense(depenseId, req.body || {});
}));

/**
 * @openapi
 * /ndf/{id}/depenses/{depenseId}:
 *   delete:
 *     tags: [Notes de frais]
 *     summary: Supprime (corbeille) une dépense d'une note de frais
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: depenseId, required: true, schema: { type: integer } }
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
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: La saisie de la ndf est verrouillée (état non modifiable) }
 */
router.delete('/:id/depenses/:depenseId', handleResponse(async (req, res) => {
  const ndf = await loadOwnedNdf(req, res);
  assertEditable(ndf, res);

  const depenseId = parseInt(req.params.depenseId, 10);
  const depense = await getDepense(depenseId);
  if (!depense || depense.ndf_id !== ndf.id) {
    res.status(404);
    throw new Error('Depense not found in this ndf');
  }
  await deleteDepense(depenseId);
  return { deleted: true, id: depenseId };
}));

/**
 * @openapi
 * /ndf/depenses/{depenseId}/detection:
 *   post:
 *     tags: [Notes de frais]
 *     summary: Lit le justificatif d'une dépense et en extrait les données
 *     description: |
 *       Soumet le justificatif de la dépense à l'API « ask » et renvoie tout ce
 *       qui a pu en être lu : `nature`, `etablissement`, `ht`, `tva`, `ttc`,
 *       `devise` (chacun `null` s'il n'a pas pu l'être). Un justificatif PDF est
 *       d'abord rendu en image, c'est sa première page qui est lue.
 *
 *       Les prompts sont ceux de sogest, aux mêmes règles : **le modèle ne fait
 *       que lire**. Il ne lui est jamais demandé le montant de TVA — celui-ci
 *       est calculé à partir de ce qui est imprimé sur le justificatif (HT et
 *       TTC, ou l'un des deux avec le taux). Un TTC inférieur au HT fait
 *       abandonner les trois montants plutôt que d'en déduire une TVA négative.
 *
 *       **Mise à jour de la dépense** : seuls les champs actuellement vides sont
 *       remplis, une valeur déjà saisie n'est jamais écrasée. Pour `ht`, `tva`
 *       et `ttc`, la valeur par défaut `0.00` compte comme vide. `applique`
 *       liste les colonnes effectivement écrites — le reste de la détection est
 *       renvoyé quand même, au client d'en faire ce qu'il veut.
 *
 *       Note : `devise` vaut toujours au moins `EUR` sur une dépense, elle n'est
 *       donc en pratique jamais remplie par cette route.
 *
 *       La dépense doit appartenir à l'utilisateur connecté, sa note de frais
 *       être modifiable, et la dépense porter un justificatif.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: depenseId, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Données lues sur le justificatif
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 depense_id:    { type: integer }
 *                 nature:        { type: string, nullable: true, description: "Nature de la dépense — écrite dans `libelle`" }
 *                 etablissement: { type: string, nullable: true }
 *                 ht:            { type: string, nullable: true }
 *                 tva:           { type: string, nullable: true, description: "Calculé, jamais lu tel quel" }
 *                 ttc:           { type: string, nullable: true }
 *                 devise:        { type: string, nullable: true, description: "Code ISO 4217, validé contre les devises connues" }
 *                 applique:      { type: array, items: { type: string }, description: "Colonnes de la dépense effectivement mises à jour" }
 *                 depense:       { type: object, description: "La dépense à jour" }
 *       400: { description: "La dépense n'a pas de justificatif (`justificatif_absent`)" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: La ndf n'appartient pas à l'utilisateur connecté }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: La saisie de la ndf est verrouillée (état non modifiable) }
 */
router.post('/depenses/:depenseId/detection', handleResponse(async (req, res) => {
  const depenseId = parseInt(req.params.depenseId, 10);
  const depense = await getDepense(depenseId);
  if (!depense) {
    res.status(404);
    throw new Error('Depense not found');
  }

  const ndf = await getNdf(depense.ndf_id);
  if (!ndf) {
    res.status(404);
    throw new Error('Ndf not found');
  }
  if (!ndfAppartientA(ndf, req.user)) {
    res.status(403);
    throw new Error('This ndf does not belong to the current user');
  }
  assertEditable(ndf, res);

  if (!depense.justificatif) {
    throw httpError(400, 'justificatif_absent', 'Cette dépense n\'a pas de justificatif');
  }

  const detecte = await detecterDepuisJustificatif(depense.justificatif);
  const aEcrire = champsAAppliquer(depense, detecte);

  // Le marqueur est posé même sans rien à écrire : la lecture a bien eu lieu,
  // inutile que sogest la relance sur ce justificatif.
  await marquerDetectionIa(depenseId);

  const aJour = Object.keys(aEcrire).length
    ? await updateDepense(depenseId, aEcrire)
    : await getDepense(depenseId);

  return {
    depense_id: depenseId,
    ...detecte,
    applique: Object.keys(aEcrire),
    depense: aJour,
  };
}));

export default router;
