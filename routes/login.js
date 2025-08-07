import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { getUserAvatar, getUserByEmail } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();
// Base path for this router
export const routePath = '/login';

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

export default router;
