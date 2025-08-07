import express from 'express';
import { handleResponse } from '../inc/response.js';
import { getHistorique } from '../inc/historique.js';

const router = express.Router();
// Base path for this router
export const routePath = '/historique';



router.get('/:table/:id', handleResponse(async (req, res) => {
    const { table, id } = req.params;
    const historique = await getHistorique({
        table, id
    });
    return historique;
}));

export default router;

