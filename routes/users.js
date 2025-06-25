import express from 'express';
import { getUsers } from '../inc/users.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();

// GET /users/
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers();
    return rows;
}));

// GET /users/
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
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

export default router;
