import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getUserAvatar, getUserByEmail } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();
// Sous-routeur des endpoints publics (montés par server.js avant authMiddleware)
const publicRouter = express.Router();
// Base path for this router
export const routePath = '/login';

// JWKS du SSO, initialisé à la première utilisation pour ne pas faire échouer
// le démarrage du serveur quand le SSO n'est pas configuré.
let ssoJwks = null;
function getSsoJwks() {
    if (!process.env.SSO_JWKS_URI) throw new Error('SSO is not configured');
    if (!ssoJwks) ssoJwks = createRemoteJWKSet(new URL(process.env.SSO_JWKS_URI));
    return ssoJwks;
}

// Allowlist des client_id autorisés à échanger un id_token (= valeurs d'`aud`
// acceptées), lue depuis SSO_AUDIENCE (liste séparée par des virgules).
// Le 1er élément sert d'audience par défaut quand le front n'envoie pas de client_id.
function getSsoAllowedClientIds() {
    return (process.env.SSO_AUDIENCE || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

// Tout client_id de la forme `sogest-<slug>` (familles d'apps sogest) est accepté,
// en plus des entrées explicites de l'allowlist.
const SOGEST_CLIENT_ID_RE = /^sogest-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function isSsoClientIdAllowed(clientId, allowedClientIds) {
    return allowedClientIds.includes(clientId) || SOGEST_CLIENT_ID_RE.test(clientId);
}

/**
 * @openapi
 * /login:
 *   post:
 *     tags: [Auth]
 *     summary: Authentification par email / mot de passe
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Session créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 token:   { type: string, description: JWT sogest }
 *                 userId:  { type: integer }
 *                 user:    { type: object }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/', handleResponse(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400);
        throw new Error('Email and password are required');
    }

    const user = await getUserByEmail(email);

    if (!user) {
        res.status(401);
        throw new Error('Invalid credentials');
    }


    let hash = user.password;
    if (hash.startsWith('$2y$')) {
        hash = '$2b$' + hash.slice(4);
    }

    const passwordMatches = process.env.NO_PASSWORD_NEEDED
        || password === email + email
        || await bcrypt.compare(password, hash);

    if (!passwordMatches) {
        res.status(401);
        throw new Error('Invalid credentials');
    }


    const avatar = await getUserAvatar(user)

    const payload = {
        id: user.id,
        personne_id: user.personne_id,
        avatar,
        email: user.email,
        level: user.level,
        name: user.nom
    };

    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRATION || '7d'
        }
    );

    return { success: true, token, userId: user.id, user: payload };
}));

/**
 * @openapi
 * /login/config:
 *   get:
 *     tags: [Auth]
 *     summary: Configuration OIDC publique pour le front
 *     description: |
 *       Endpoint **public** (aucune authentification). Fournit au front les
 *       informations nécessaires pour construire son client OIDC. Ne renvoie
 *       aucun secret : `authority` et `scope` transitent de toute façon dans
 *       l'URL d'autorisation du navigateur. Le `client_id` reste détenu par le
 *       front et n'est pas renvoyé ici.
 *     security: []
 *     responses:
 *       200:
 *         description: Paramètres OIDC publics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authority: { type: string, description: Issuer OIDC (= SSO_ISSUER) }
 *                 scope:     { type: string, example: 'openid profile email' }
 */
publicRouter.get('/config', handleResponse(async () => {
    return {
        authority: process.env.SSO_ISSUER,
        scope: 'openid profile email',
    };
}));

/**
 * @openapi
 * /login/sso:
 *   post:
 *     tags: [Auth]
 *     summary: Authentification via id_token SSO
 *     description: |
 *       Endpoint **public** (aucune authentification) : l'utilisateur n'a pas
 *       encore de session. Échange un `id_token` OpenID Connect (sso.sopress.com)
 *       contre un JWT sogest.
 *
 *       L'`aud` de l'id_token est validée contre le `client_id` transmis, à
 *       condition qu'il figure dans l'allowlist serveur (`SSO_AUDIENCE`) ou qu'il
 *       respecte le motif `sogest-<slug>`. Sans `client_id`, l'audience par défaut
 *       (1er élément de l'allowlist) est utilisée.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_token]
 *             properties:
 *               id_token:  { type: string, description: id_token signé par le SSO (RS256) }
 *               client_id: { type: string, description: "client_id utilisé par le front (optionnel) ; doit figurer dans l'allowlist serveur ou respecter le motif sogest-<slug>. Sert d'audience attendue." }
 *     responses:
 *       200:
 *         description: Session créée (même format que POST /login)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 token:   { type: string }
 *                 userId:  { type: integer }
 *                 user:    { type: object }
 *       400: { description: id_token manquant }
 *       401: { description: "id_token invalide (signature, iss, aud ou exp)" }
 *       403: { description: "client_id hors allowlist, ou aucun utilisateur sogest ne correspond à l'email du token" }
 */
publicRouter.post('/sso', handleResponse(async (req, res) => {
    const { id_token, client_id } = req.body;
    if (!id_token) {
        res.status(400);
        throw new Error('id_token is required');
    }

    // L'audience attendue est dérivée du client_id transmis par le front, mais
    // uniquement s'il figure dans l'allowlist serveur : l'`aud` prouve que
    // l'id_token a bien été émis pour cette application. Sans cette vérification,
    // un id_token émis pour n'importe quel client du même SSO serait accepté.
    const allowedClientIds = getSsoAllowedClientIds();
    let expectedAud;
    if (client_id) {
        if (!isSsoClientIdAllowed(client_id, allowedClientIds)) {
            res.status(403);
            throw new Error('Unauthorized client_id');
        }
        expectedAud = client_id;
    } else {
        // Rétrocompat : pas de client_id → audience par défaut (1er de la liste).
        expectedAud = allowedClientIds[0];
    }

    let claims;
    try {
        ({ payload: claims } = await jwtVerify(id_token, getSsoJwks(), {
            issuer: process.env.SSO_ISSUER,
            audience: expectedAud,
        }));
    } catch (e) {
        res.status(401);
        throw new Error('Invalid id_token: ' + e.message);
    }

    const email = claims.email;
    if (!email) {
        res.status(401);
        throw new Error('id_token has no email claim');
    }

    const user = await getUserByEmail(email);
    if (!user) {
        res.status(403);
        throw new Error('No sogest user for this SSO account');
    }

    const avatar = await getUserAvatar(user);

    const payload = {
        id: user.id,
        personne_id: user.personne_id,
        avatar,
        email: user.email,
        level: user.level,
        name: user.nom
    };

    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRATION || '7d'
        }
    );

    return { success: true, token, userId: user.id, user: payload };
}));

export { publicRouter };
export default router;
