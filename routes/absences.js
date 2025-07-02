import express from 'express';
import { getAbsences } from '../inc/absences.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';

/**
 * @api {get} /absences/:userId/:year?/:month? Get absences for a user
 * @apiName GetAbsences
 * @apiGroup Absences
 * @apiHeader {String} Authorization Bearer token or JWT.
 * @apiParam {Number} userId User identifier.
 * @apiParam {Number} [year] Year filter.
 * @apiParam {Number{1-12}} [month] Month filter.
 * @apiSuccess {Object[]} data Array of absence records.
 * @apiExample {bruno} Test with Bruno
 *   See {@link ../doc/Absences.bru doc/Absences.bru}.
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
