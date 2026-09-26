import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getUserAvatar, getUserByEmail, getUserCapabilities } from '../inc/rh/users.js';
import { getSsoclient } from '../inc/auth/ssoclients.js';
import { creerCompteMattermost, getEtatMattermost, synchroMotDePasseMattermost } from '../inc/rh/mattermost.js';
import { handleResponse } from '../inc/core/response.js';

dotenv.config();
const router = express.Router();
// Sous-routeur des endpoints publics (montés par server.js avant authMiddleware)
const publicRouter = express.Router();
// Base path for this router
export const routePath = '/login';

// JWKS du SSO, initialisé à la première utilisation pour ne pas faire échouer
// le démarrage du serveur quand le SSO n'est pas configuré. Mis en cache par
// URI : chaque domaine custom (cf. clients SSO) a son propre JWKS set.
const ssoJwksByUri = new Map();
function getSsoJwks(jwksUri = process.env.SSO_JWKS_URI) {
    if (!jwksUri) throw new Error('SSO is not configured');
    if (!ssoJwksByUri.has(jwksUri)) {
        ssoJwksByUri.set(jwksUri, createRemoteJWKSet(new URL(jwksUri)));
    }
    return ssoJwksByUri.get(jwksUri);
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
 * Remplace le host d'une URL par le domaine custom d'un client SSO, en
 * conservant protocole, port, chemin et query d'origine. Renvoie l'URL inchangée
 * si elle est absente/invalide ou si aucun domaine n'est fourni.
 * @param {string} urlString  URL d'origine (ex. SSO_ISSUER / SSO_JWKS_URI)
 * @param {string} domain     domaine custom du client (host, sans schéma)
 * @returns {string}
 */
function applyCustomDomain(urlString, domain) {
    if (!urlString || !domain) return urlString;
    try {
        const url = new URL(urlString);
        url.host = domain;
        return url.toString();
    } catch {
        return urlString;
    }
}

/**
 * Construit la session (payload + JWT) pour un utilisateur authentifié.
 * Source unique partagée par /login et /login/sso ; embarque les capacités
 * (`can`) pour le gating UI côté front.
 * @param {Object} user  ligne utilisateur (id, personne_id, email, level, nom)
 * @returns {Promise<{success: boolean, token: string, userId: number, user: Object}>}
 */
async function buildUserSession(user) {
    const avatar = await getUserAvatar(user);
    const can = await getUserCapabilities(user.id);

    const payload = {
        id: user.id,
        personne_id: user.personne_id,
        avatar,
        email: user.email,
        level: user.level,
        name: user.nom,
        can,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRATION || '7d',
    });

    return { success: true, token, userId: user.id, user: payload };
}

/**
 * Mot de passe qu'un utilisateur vient de saisir, seul moment où on l'a en
 * clair : il crée son compte Mattermost s'il a le droit et n'en a pas encore,
 * ou devient celui de son compte Mattermost s'il est synchronisé. Un échec est
 * journalisé sans empêcher la connexion : un compte en attente le reste, et le
 * SSO redemandera le mot de passe à une prochaine connexion.
 *
 * @param {number} userId
 * @param {string} password  mot de passe en clair, vérifié
 */
async function activerMattermost(userId, password) {
    try {
        const etat = await getEtatMattermost(userId);
        if (etat?.enAttente) {
            await creerCompteMattermost(userId, password);
        } else if (etat?.synchro) {
            await synchroMotDePasseMattermost(userId, password);
        }
    } catch (e) {
        console.error(`Mattermost : compte de l'utilisateur ${userId} non mis à jour —`, e.message);
    }
}

/**
 * @openapi
 * /login:
 *   post:
 *     tags: [Auth]
 *     summary: Authentification par email / mot de passe
 *     description: |
 *       Si l'utilisateur a reçu le droit Mattermost et n'a pas encore de compte
 *       Mattermost, celui-ci est créé avec le mot de passe saisi ; si son compte
 *       Mattermost est synchronisé, il reçoit ce mot de passe. Jamais avec les
 *       passe-droits de dev, et un échec n'empêche pas la connexion.
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

    // Le vrai mot de passe, et non l'un des passe-droits de dev : lui seul peut
    // servir à créer le compte Mattermost.
    const vraiMotDePasse = await bcrypt.compare(password, hash);
    const passwordMatches = process.env.NO_PASSWORD_NEEDED
        || password === email + email
        || vraiMotDePasse;

    if (!passwordMatches) {
        res.status(401);
        throw new Error('Invalid credentials');
    }

    if (vraiMotDePasse) {
        await activerMattermost(user.id, password);
    }


    return await buildUserSession(user);
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
 *
 *       Le paramètre **optionnel** `clientId` permet de cibler un client SSO :
 *       si ce client a défini un domaine custom (champ `domain`), le host de
 *       `authority` (= SSO_ISSUER) est remplacé par ce domaine. Sans `clientId`
 *       (ou client sans domaine custom), la valeur par défaut est renvoyée.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         required: false
 *         schema: { type: string }
 *         description: client_id (ou id) du client SSO ciblé, pour appliquer son domaine custom.
 *     responses:
 *       200:
 *         description: Paramètres OIDC publics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authority: { type: string, description: Issuer OIDC (= SSO_ISSUER, host remplacé par le domaine custom du client si défini) }
 *                 scope:     { type: string, example: 'openid profile email' }
 */
publicRouter.get('/config', handleResponse(async (req) => {
    const clientId = req.query?.clientId;

    let domain = null;
    if (clientId) {
        const client = await getSsoclient(clientId);
        domain = client?.domain || null;
    }

    return {
        authority: applyCustomDomain(process.env.SSO_ISSUER, domain),
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

    // Si le client SSO a un domaine custom, l'id_token a été émis par cet issuer
    // et ses clés sont publiées sur ce domaine : on aligne issuer + JWKS dessus.
    let issuer = process.env.SSO_ISSUER;
    let jwksUri = process.env.SSO_JWKS_URI;
    if (client_id) {
        const client = await getSsoclient(client_id);
        const domain = client?.domain || null;
        if (domain) {
            issuer = applyCustomDomain(issuer, domain);
            jwksUri = applyCustomDomain(jwksUri, domain);
        }
    }

    let claims;
    try {
        ({ payload: claims } = await jwtVerify(id_token, getSsoJwks(jwksUri), {
            issuer,
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

    return await buildUserSession(user);
}));

export { publicRouter };
export default router;
