import express from 'express';
import { handleResponse, httpError } from '../inc/core/response.js';
import { etatSynchroCompteMattermost, repondreSynchroMattermost } from '../inc/rh/mattermost.js';

/**
 * Routes appelées par le plugin Mattermost com.sopress.sogest-login, avec son
 * jeton applicatif (cantonné à /mattermost par `tokenScopes` dans config.json).
 * Les comptes y sont désignés par leur id Mattermost : c'est tout ce que le
 * plugin connaît d'eux.
 */
const router = express.Router();
export const routePath = '/mattermost';

/** Réservé aux appels machine (jeton applicatif), jamais à un JWT d'utilisateur. */
function exigerJetonApplicatif(req) {
    if (req.isJwt !== false) {
        throw httpError(403, 'non_habilite', 'Réservé au plugin Mattermost.');
    }
}

/**
 * @openapi
 * /mattermost/comptes/{idMattermost}/synchro:
 *   get:
 *     tags: [Mattermost]
 *     summary: Faut-il proposer la synchro à ce compte Mattermost ?
 *     description: |
 *       Appelé par le plugin après la connexion d'un compte Mattermost.
 *       `aProposer` : compte relié à un utilisateur sogest qui a le droit
 *       Mattermost, pas encore synchronisé, sans refus depuis moins d'une semaine.
 *     parameters:
 *       - { in: path, name: idMattermost, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: État de la synchro
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 relie:     { type: boolean }
 *                 synchro:   { type: boolean }
 *                 aProposer: { type: boolean }
 *       403: { description: Réservé au plugin Mattermost }
 */
router.get('/comptes/:idMattermost/synchro', handleResponse(async (req) => {
    exigerJetonApplicatif(req);
    return await etatSynchroCompteMattermost(req.params.idMattermost);
}));

/**
 * @openapi
 * /mattermost/comptes/{idMattermost}/synchro:
 *   post:
 *     tags: [Mattermost]
 *     summary: Réponse d'un compte Mattermost à la proposition de synchro
 *     description: |
 *       `oui` : le compte Mattermost prend l'email principal de sogest (la valeur
 *       liée `email_mattermost` disparaît) et devient synchronisé ; il recevra
 *       le mot de passe de sogest à la prochaine saisie. `non` : refus daté,
 *       reproposé dans une semaine.
 *     parameters:
 *       - { in: path, name: idMattermost, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reponse]
 *             properties:
 *               reponse: { type: string, enum: [oui, non] }
 *     responses:
 *       200:
 *         description: Résultat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 relie:   { type: boolean }
 *                 synchro: { type: boolean }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { description: Réservé au plugin Mattermost }
 *       502: { description: Mattermost a refusé le changement d'email }
 */
router.post('/comptes/:idMattermost/synchro', handleResponse(async (req) => {
    exigerJetonApplicatif(req);
    const reponse = req.body?.reponse;
    if (reponse !== 'oui' && reponse !== 'non') {
        throw httpError(400, 'reponse_invalide', 'La réponse doit être « oui » ou « non ».');
    }
    try {
        return await repondreSynchroMattermost(req.params.idMattermost, reponse === 'oui');
    } catch (e) {
        if (e.errorCode) throw e;
        throw httpError(502, 'mattermost', e.message);
    }
}));

export default router;
