import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getDocumentsForPersonne, getDocument } from '../inc/documents.js';
import { handleResponse } from '../inc/response.js';

dotenv.config();
const router = express.Router();

export const routePath = '/documents';
export const requireAuth = true;

/**
 * @api {get} /documents Documents de l'utilisateur
 * @apiName GetDocuments
 * @apiGroup Documents
 * @apiUse JwtHeader
 * @apiSuccess {Object[]} documents Liste des documents
 */

router.get('/', handleResponse(async (req, res) => {
    const { user } = req

    const documents = await getDocumentsForPersonne(user.personne_id);

    return documents
}));

/**
 * @api {get} /documents Documents de l'utilisateur
 * @apiName GetDocuments
 * @apiGroup Documents
 * @apiUse JwtHeader
 * @apiSuccess {Object[]} documents Liste des documents
 */

router.get('/:origin/:id', handleResponse(async (req, res) => {
    const { origin, id } = req.params;
    const { user } = req

    const document = await getDocument({origin, id, personneId : user.personne_id});

    return document
}));


export default router;

