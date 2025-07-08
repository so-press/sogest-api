import express from 'express';
import { getUsers } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/users';


/**
 * @api {get} /users Liste des utilisateurs
 * @apiName GetUsers
 * @apiGroup Users
 * @apiSuccess {Object[]} users Liste des utilisateurs
 */
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

/**
 * @api {get} /users/:id Détails d'un utilisateur
 * @apiName GetUser
 * @apiGroup Users
 * @apiParam {Number} id ID de l'utilisateur
 * @apiSuccess {Object} user Informations de l'utilisateur
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
 * @api {get} /users/level/:level Utilisateurs par niveau
 * @apiName GetUsersByLevel
 * @apiGroup Users
 * @apiParam {String} level Niveau d'accès
 * @apiSuccess {Object[]} users Utilisateurs correspondants
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

export default router;

