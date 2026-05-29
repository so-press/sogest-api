import express from 'express';
import sharp from 'sharp';
import { AVATAR_SIZES, getUser, getUsers, getUserAvatar, setUserLink, getUserLinks, isReservedUserField } from '../inc/rh/users.js';
import { handleResponse } from '../inc/core/response.js';
import { jwtOnlyMiddleware } from '../inc/middleware/jwt.js';

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
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Utilisateur correspondant au JWT
 *     description: |
 *       Renvoie l'utilisateur connecté (résolu depuis le JWT). **JWT obligatoire**
 *       (un token statique n'identifie pas d'utilisateur).
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Utilisateur connecté, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', jwtOnlyMiddleware, handleResponse(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found for this token');
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return { ...req.user, personne: `${baseUrl}/personnes/${req.user.personne_id}` };
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
 * /users/me/links/{champ}:
 *   put:
 *     tags: [Users]
 *     summary: Crée ou met à jour une meta (« link ») de l'utilisateur connecté
 *     description: |
 *       Upsert d'une valeur liée de l'utilisateur courant (table `links`,
 *       clé unique `champ`/`cle`/`table`). **JWT obligatoire** : l'utilisateur ne
 *       peut modifier que ses propres metas. Renvoie l'utilisateur à jour.
 *
 *       **Champs préfixés `_` (metas internes)** : un `champ` commençant par `_`
 *       est stocké normalement mais **n'est jamais fusionné** dans l'objet user
 *       renvoyé par les routes users (cette réponse, `GET /users`, `GET /users/:id`,
 *       réponse de login). Il reste lisible uniquement via `GET /users/:id/links`.
 *       Utiliser ce préfixe pour des metas qui ne doivent pas être exposées
 *       largement.
 *
 *       **Contraintes** :
 *       - le `champ` ne peut pas porter le nom d'une colonne de la table `users`
 *         (ex. `telephone`, `email`, `level`…) — sinon `400` (il écraserait la
 *         vraie valeur du user) ;
 *       - `libelle` est optionnel : posé à la création (`''` par défaut), et
 *         **laissé inchangé** lors d'un update s'il n'est pas fourni.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: champ, required: true, schema: { type: string }, description: 'Nom de la meta (préfixe `_` = interne, non exposée dans l''objet user)' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [valeur]
 *             properties:
 *               valeur:  { type: string }
 *               libelle: { type: string, description: 'Libellé d''affichage (optionnel ; inchangé en base si omis lors d''un update)' }
 *     responses:
 *       200: { description: Utilisateur mis à jour, content: { application/json: { schema: { type: object } } } }
 *       400: { description: 'valeur manquante, ou champ réservé (= colonne de la table users)' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/me/links/:champ', jwtOnlyMiddleware, handleResponse(async (req, res) => {
    const champ = req.params.champ;
    const { valeur, libelle } = req.body || {};
    if (valeur === undefined) {
        res.status(400);
        throw new Error('valeur is required');
    }
    if (await isReservedUserField(champ)) {
        res.status(400);
        throw new Error(`champ "${champ}" est réservé (colonne de la table users)`);
    }

    await setUserLink(req.user.id, champ, valeur, libelle);
    return await getUser(req.user.id);
}));

/**
 * @openapi
 * /users/{id}/links:
 *   get:
 *     tags: [Users]
 *     summary: Liste des metas (« links ») d'un utilisateur
 *     description: |
 *       Renvoie **toutes** les valeurs liées de l'utilisateur, **y compris** les
 *       champs internes préfixés `_`.
 *
 *       À noter : les champs `_` ne sont volontairement **pas** fusionnés dans
 *       l'objet user des autres routes (`GET /users`, `GET /users/:id`, login,
 *       réponse du PUT meta) ; cette route est le **seul** endroit qui les expose.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des metas
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
 *                       champ:   { type: string }
 *                       valeur:  { type: string }
 *                       libelle: { type: string }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/:id/links', handleResponse(async (req) => {
    return await getUserLinks(req.params.id, { includeInternal: true });
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

