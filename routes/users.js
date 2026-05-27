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
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Liste des utilisateurs
 *     responses:
 *       200:
 *         description: Liste paginée des utilisateurs
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
    const rows = await getUsers();
    return rows;
}));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Détails d'un utilisateur
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Informations de l'utilisateur, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
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
 * @openapi
 * /users/level/{level}:
 *   get:
 *     tags: [Users]
 *     summary: Utilisateurs par niveau d'accès
 *     parameters:
 *       - { in: path, name: level, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Utilisateurs correspondants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

/**
 * @openapi
 * /users/{id}/avatar:
 *   get:
 *     tags: [Users]
 *     summary: Avatar (image binaire) d'un utilisateur
 *     description: |
 *       Endpoint **public** (aucune authentification). Renvoie le contenu binaire de
 *       l'avatar redimensionné carré (cover). Si Gravatar renvoie 404, bascule sur
 *       l'image définie par `DEFAULT_AVATAR`.
 *     security: []
 *     parameters:
 *       - { in: path,  name: id,   required: true, schema: { type: integer } }
 *       - in: query
 *         name: size
 *         required: false
 *         schema: { type: string, enum: [small, medium, big], default: medium }
 *         description: small=64px, medium=128px, big=256px
 *     responses:
 *       200:
 *         description: Image binaire
 *         content:
 *           image/*:
 *             schema: { type: string, format: binary }
 *       404: { $ref: '#/components/responses/NotFound' }
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

