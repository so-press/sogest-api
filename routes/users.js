import express from 'express';
import { getUsers } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/users';


/**
 * Récupère la liste de tous les utilisateurs.
 *
 * @route GET /users
 * @returns {Object[]} Liste des utilisateurs.
 * @throws {Error} En cas d’échec lors de la récupération.
 */
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

/**
 * Récupère les détails d’un utilisateur spécifique par son ID, avec liens associés.
 *
 * @route GET /users/:id
 * @param {string} req.params.id - ID de l’utilisateur à récupérer.
 * @returns {Object} Informations de l’utilisateur, incluant des liens vers ses absences et sa fiche personnelle.
 * @throws {Error} Si l’utilisateur est introuvable ou en cas d’erreur serveur.
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
 * Récupère les utilisateurs correspondant à un niveau d'accès donné.
 *
 * @route GET /users/level/:level
 * @param {string} req.params.level - Niveau d’accès à filtrer.
 * @returns {Object[]} Liste des utilisateurs ayant le niveau demandé.
 * @throws {Error} En cas d’échec lors de la récupération.
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

export default router;
