import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getDocumentsForPersonne } from '../inc/documents.js';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();

export const routePath = '/documents';
export const requireAuth = true;

/**
 * @openapi
 * /documents:
 *   get:
 *     summary: Documents de l'utilisateur
 *     tags:
 *       - Documents
 *     responses:
 *       200:
 *         description: Liste des documents
 */

router.get('/', handleResponse(async (req, res) => {
    const { user } = req

    const documents = await getDocumentsForPersonne(user.personne_id);

    return documents
}));


export default router;

