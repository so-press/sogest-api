import express from 'express';
import { getAbsences } from '../inc/absences.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';

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
