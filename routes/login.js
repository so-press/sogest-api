import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getUserByEmail } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();

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

    const passwordMatches = await bcrypt.compare(password, hash);

    if (!passwordMatches) {
        res.status(401);
        throw new Error('Invalid credentials');
    }

    delete user.pass;
    delete user.password;

    const token = jwt.sign(
        {
            id: user.id,
            email: user.email,
            level: user.level,
            name: user.nom
        }, 
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRATION || '7d'
        }
    );

    return { success: true, token };
}));

export default router;
