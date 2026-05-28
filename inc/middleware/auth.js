import fs from 'fs';
import jwt from 'jsonwebtoken';
import { getUser } from '../users.js';

// Load config file
const config = JSON.parse(fs.readFileSync('./config/config.json'));
const tokens = Object.values(config.tokens);

// Auth middleware
export async function authMiddleware(req, res, next) {
  const raw = req.headers['authorization'] || '';
  const token = raw.split('Bearer ')[1] || false;

  if (!token) {
    return res.status(403).json({ error: 'Unauthorized: No token received' });
  }

  if (tokens.includes(token)) {
    req.isJwt = false;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await getUser(decoded.id);
    // JWT valide mais utilisateur introuvable / inactif / en corbeille
    // (getUser filtre trash<>1 et actif=1) : on refuse. Sinon req.user vaut
    // `false`, le scoping des routes est silencieusement ignoré et peut fuiter
    // des données (ex. GET /ndf renvoyait toutes les ndf).
    if (!req.user) {
      return res.status(403).json({ error: 'Unauthorized: user not found or inactive' });
    }
    req.isJwt = true;
    next();
  } catch (err) {
    console.log(err)
    return res.status(403).json({ error: 'Unauthorized: Invalid token' });
  }
};
