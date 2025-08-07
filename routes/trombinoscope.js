import express from 'express';
import { handleResponse } from '../inc/response.js';
import { getPermanents } from '../inc/personnes.js';

const router = express.Router();
// Base path for this router
export const routePath = '/trombinoscope';



router.get('/', handleResponse(async (req, res) => {
    const rows = await getPermanents();
    return rows;
}));

export default router;

