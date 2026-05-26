import express from 'express';
import sharp from 'sharp';
import { AVATAR_SIZES, getUser, getUsers, getUserAvatar } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Sous-routeur des endpoints publics (montés par server.js avant authMiddleware)
const publicRouter = express.Router();
// Base path for this router
export const routePath = '/users';


/**
 * @api {get} /users Liste des utilisateurs
 * @apiName GetUsers
 * @apiGroup Users
 * @apiUse globalToken
 * @apiSuccess {Object[]} users Liste des utilisateurs
 */
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

/**
 * @api {get} /users/:id Détails d'un utilisateur
 * @apiName GetUser
 * @apiGroup Users
 * @apiParam {Number} id ID de l'utilisateur
 * @apiUse globalToken
 * @apiSuccess {Object} user Informations de l'utilisateur
 */
router.get('/:id', handleResponse(async (req, res) => {
    const rows = await getUsers({ id: req.params.id });
    if (!rows[0]) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    const user = rows[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return {
        ...user,
        personne: `${baseUrl}/personnes/${user.personne_id}`
    };
}));

/**
 * @api {get} /users/level/:level Utilisateurs par niveau
 * @apiName GetUsersByLevel
 * @apiGroup Users
 * @apiParam {String} level Niveau d'accès
 * @apiUse globalToken
 * @apiSuccess {Object[]} users Utilisateurs correspondants
 */

router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

/**
 * @api {get} /users/:id/avatar Image avatar d'un utilisateur
 * @apiName GetUserAvatar
 * @apiGroup Users
 * @apiParam {Number} id ID de l'utilisateur
 * @apiQuery {String="small","medium","big"} [size=medium] Taille demandée
 *   (small=64px, medium=128px, big=256px). L'image source est redimensionnée
 *   carrée (cover) à la taille demandée.
 * @apiUse globalToken
 * @apiDescription Renvoie le contenu binaire de l'avatar redimensionné.
 * Si Gravatar renvoie 404, bascule sur l'image définie par `DEFAULT_AVATAR`.
 */
async function safeFetch(url, timeoutMs = 5000) {
    if (!url) return null;
    try {
        return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        console.warn(`avatar fetch failed for ${url}: ${err.message}`);
        return null;
    }
}

publicRouter.get('/:id/avatar', async (req, res) => {
    try {
        console.log(`Fetching avatar for user ${req.params.id}`);
        const user = await getUser(req.params.id);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const size = AVATAR_SIZES[req.query.size] ? req.query.size : 'medium';
        const px = AVATAR_SIZES[size];

        let url = await getUserAvatar(user, size);
        let upstream = await safeFetch(url);

        if ((!upstream || !upstream.ok) && process.env.DEFAULT_AVATAR && url !== process.env.DEFAULT_AVATAR) {
            url = process.env.DEFAULT_AVATAR;
            upstream = await safeFetch(url);
        }

        if (!upstream || !upstream.ok) {
            res.status(404).json({ error: 'Avatar not found' });
            return;
        }

        const inputBuf = Buffer.from(await upstream.arrayBuffer());
        const { data, info } = await sharp(inputBuf)
            .resize(px, px, { fit: 'cover' })
            .toBuffer({ resolveWithObject: true });

        res.set('Content-Type', `image/${info.format}`);
        res.send(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error', message: '' + err });
    }
});

export { publicRouter };
export default router;

