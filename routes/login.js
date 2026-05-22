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

/**
 * @api {post} /login Authentification
 * @apiName Login
 * @apiGroup Auth
 * @apiBody {String} email Email de l'utilisateur
 * @apiBody {String} password Mot de passe
 * @apiUse globalToken
 * @apiSuccess {Object} session Informations de session
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

    const passwordMatches = process.env.NO_PASSWORD_NEEDED || await bcrypt.compare(password, hash);

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
 * @api {post} /login/sso Authentification via id_token SSO
 * @apiName LoginSso
 * @apiGroup Auth
 * @apiDescription Échange un `id_token` OpenID Connect (sso.sopress.com) contre un
 * JWT sogest. Appelé avec un token applicatif statique (l'utilisateur n'a pas encore de JWT).
 * @apiBody {String} id_token id_token signé par le SSO (RS256)
 * @apiUse globalToken
 * @apiSuccess {Object} session Informations de session (même format que POST /login)
 * @apiError 400 id_token manquant
 * @apiError 401 id_token invalide (signature, iss, aud ou exp)
 * @apiError 403 Aucun utilisateur sogest ne correspond à l'email du token
 */
router.post('/sso', handleResponse(async (req, res) => {
    const { id_token } = req.body;
    if (!id_token) {
        res.status(400);
        throw new Error('id_token is required');
    }

    let claims;
    try {
        ({ payload: claims } = await jwtVerify(id_token, getSsoJwks(), {
            issuer: process.env.SSO_ISSUER,
            audience: process.env.SSO_AUDIENCE,
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

export default router;
