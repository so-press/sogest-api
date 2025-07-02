import express from 'express';
import { getUsers } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/users';

/**
 * @api {get} /users/ List users
 * @apiName GetUsers
 * @apiGroup Users
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam (Query) {Number{1..}} [page=1] Page number for pagination.
 * @apiParam (Query) {Number{1..}} [limit=50] Number of items per page.
 * @apiSuccess {Object[]} data Array of user objects.
 * @apiSuccess {Object}   pagination Pagination information.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Users.bru doc/Users.bru}.
 */

// GET /users/
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

// GET /users/
/**
 * @api {get} /users/:id Get user by id
 * @apiName GetUser
 * @apiGroup Users
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam {Number} id User identifier.
 * @apiSuccess {Number} id User id.
 * @apiSuccess {Number} personne_id Linked personne id.
 * @apiSuccess {String} nom Nom de l'utilisateur.
 * @apiSuccess {String} prenom Prénom de l'utilisateur.
 * @apiSuccess {String} email Adresse email principale.
 * @apiSuccess {String} level Niveau d'accès.
 * @apiSuccess {Object} links Hyperlinks to related resources.
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

// GET /users/level/:level
/**
 * @api {get} /users/level/:level Get users by level
 * @apiName GetUsersByLevel
 * @apiGroup Users
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam {String} level Access level to filter.
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

export default router;
