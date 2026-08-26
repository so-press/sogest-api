import express from 'express';
import { getPersonne, getPersonnes, updatePersonne, getConges } from '../inc/rh/personnes.js';
import { handleResponse } from '../inc/core/response.js';
import { isUltraAdminRequest } from '../inc/core/access.js';
const router = express.Router();
// Base path for this router
export const routePath = '/personne';
export const requireAuth = true;

/**
 * @openapi
 * /personne:
 *   get:
 *     tags: [Personne]
 *     summary: Infos de la personne liée à l'utilisateur connecté
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Informations de la personne, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
    const personne = await getPersonne({ id: req.user.personne_id });
    return personne;
}));

/**
 * @openapi
 * /personne/conges:
 *   get:
 *     tags: [Personne]
 *     summary: Congés de la personne connectée (meta.conges)
 *     description: |
 *       Soldes de congés issus du dernier bulletin de paie. `personneId` permet
 *       de viser une autre personne : réservé aux **ultra admins** (sinon `403`),
 *       pour l'affichage du planning d'un collaborateur dans l'app absences.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: query, name: personneId, schema: { type: integer }, description: 'Autre personne (ultra admins uniquement)' }
 *     responses:
 *       200: { description: Objet congés de la personne, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Personne tierce demandée par un non-ultra-admin }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/conges', handleResponse(async (req, res) => {
    // Personne ciblée : soi-même par défaut, un tiers pour les ultra admins.
    let personneId = req.user.personne_id;
    const demande = req.query.personneId;
    if (demande !== undefined && demande !== '') {
        const cible = parseInt(demande, 10);
        if (isNaN(cible)) {
            res.status(400);
            throw new Error('Invalid personne ID');
        }
        if (cible !== req.user.personne_id && !isUltraAdminRequest(req)) {
            res.status(403);
            throw new Error("Réservé aux administrateurs : congés d'un tiers");
        }
        personneId = cible;
    }

    const conges = await getConges(personneId);
    if (!conges) {
        res.status(404);
        throw new Error('Aucune donnée de congés pour cette personne');
    }
    return conges;
}));

/**
 * @openapi
 * /personne:
 *   put:
 *     tags: [Personne]
 *     summary: Mise à jour de la personne connectée
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: true }
 *     responses:
 *       200: { description: Données mises à jour, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/', handleResponse(async (req, res) => {
    const { user } = req
    const data = req.body;
    const updated = await updatePersonne(user.personne_id, data);
    if (updated) {
        return await getPersonne({ id: user.personne_id })
    }
}));
export default router;

