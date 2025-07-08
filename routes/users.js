import express from 'express';
import { getUsers } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/users';


/**
 * @openapi
 * /users:
 *   get:
 *     summary: Liste des utilisateurs
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 */
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Détails d'un utilisateur
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Informations de l'utilisateur
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
        links: {
            absences: `${baseUrl}/absences/${user.id}`,
            personne: `${baseUrl}/personnes/${user.personne_id}`
        }
    };
}));

/**
 * @openapi
 * /users/level/{level}:
 *   get:
 *     summary: Utilisateurs par niveau
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: level
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Utilisateurs correspondants
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

export default router;

