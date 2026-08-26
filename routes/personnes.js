import express from 'express';
import { getPersonne, getPersonnes, searchPermanents, updatePersonne } from '../inc/rh/personnes.js';
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
 * /personnes/permanents:
 *   get:
 *     tags: [Personnes]
 *     summary: Recherche parmi les permanents (autocomplétion)
 *     description: |
 *       Personnes dont le contrat figure dans l'option `CONTRATS_PERMANENTS`
 *       (même périmètre que `GET /trombinoscope`) **et** qui disposent d'un
 *       compte utilisateur actif : celles sans compte sont exclues, faute de
 *       planning d'absences rattachable.
 *
 *       `search` est une recherche « façon slug » : insensible à la casse, aux
 *       accents et à la ponctuation, appliquée au nom, au prénom, au nom complet
 *       dans les deux ordres et à l'email. Sans `search`, la liste complète est
 *       renvoyée (dans la limite de `limit`).
 *
 *       Pensée pour alimenter un champ d'autocomplétion : `limit` borne le
 *       nombre de propositions **avant** la pagination générique.
 *       Le paramètre `id` sert la résolution inverse : il renvoie la fiche d'un
 *       `personne_id` connu (0 ou 1 élément), ce qui permet de vérifier d'un
 *       appel qu'une personne appartient bien au périmètre et de récupérer son
 *       `user_id`.
 *     parameters:
 *       - { in: query, name: search, schema: { type: string }, description: Terme recherché (nom, prénom, email) }
 *       - { in: query, name: id,     schema: { type: integer }, description: Restreint à une personne précise }
 *       - { in: query, name: limit,  schema: { type: integer, default: 20 }, description: Nombre maximum de propositions }
 *     responses:
 *       200:
 *         description: Permanents correspondants
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
 *                       id:          { type: integer, description: id de la personne }
 *                       user_id:     { type: integer, description: id du compte utilisateur rattaché }
 *                       nom:         { type: string }
 *                       prenom:      { type: string }
 *                       nom_complet: { type: string }
 *                       email:       { type: string, nullable: true }
 *                       contrat:     { type: string, nullable: true }
 *                       equipe:      { type: string, nullable: true }
 *                       photo:       { type: string, nullable: true }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
// Déclarée avant `/:id` : sans ça, « permanents » serait capté comme un id.
router.get('/permanents', handleResponse(async (req) => {
  const { search, id, limit } = req.query;
  return await searchPermanents({
    search: search || null,
    id: id !== undefined && id !== '' ? parseInt(id, 10) : null,
    limit: limit !== undefined ? parseInt(limit, 10) : 20,
  });
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
  if (!personne) {
    res.status(404);
    throw new Error('Personne introuvable');
  }
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

