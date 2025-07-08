import express from 'express';
import { getAbsences } from '../inc/absences.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';

/**
 * Récupère les absences d'un utilisateur donné, avec possibilité de filtrer par année et mois.
 *
 * @route GET /:userId/:year?/:month?
 * @param {string} req.params.userId - ID de l'utilisateur.
 * @param {string} [req.params.year] - Année facultative pour filtrer les absences.
 * @param {string} [req.params.month] - Mois facultatif pour filtrer les absences.
 * @returns {Object[]} Liste des absences.
 * @throws {Error} En cas d’erreur serveur.
 */

router.get('/:userId/:year?/:month?', handleResponse(async (req, res) => {
    const { userId, year, month } = req.params;
    const rows = await getAbsences({
        userId: parseInt(userId, 10),
        year: year ? parseInt(year, 10) : null,
        month: month ? parseInt(month, 10) : null
    });
    res.json(rows);
}));

export default router;
