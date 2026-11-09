import fs from 'fs';
import jwt from 'jsonwebtoken';
import { getUser } from '../rh/users.js';
import { resoudreToken } from '../auth/apiclients.js';

// Load config file
const config = JSON.parse(fs.readFileSync('./config/config.json'));
const tokens = Object.values(config.tokens);
// Nom du jeton statique correspondant à chaque valeur : permet de restreindre
// le périmètre d'un jeton applicatif (cf. `tokenScopes` dans config.json et
// `isEquipeWritableByRequest()` dans inc/core/access.js).
const tokenNames = new Map(Object.entries(config.tokens).map(([name, value]) => [value, name]));
const tokenScopes = config.tokenScopes || {};

// Routes auxquelles un jeton applicatif est cantonné, s'il y en a :
//   "tokenScopes": { "mattermost-plugin": { "routes": ["/mattermost"] } }
// Sans `routes`, le jeton garde l'accès à toute l'API (comportement historique).
function routeAutorisee(scope, path) {
  const routes = scope?.routes;
  if (!Array.isArray(routes)) return true;
  return routes.some((r) => path === r || path.startsWith(r + '/'));
}

// Auth middleware
export async function authMiddleware(req, res, next) {
  const raw = req.headers['authorization'] || '';
  const token = raw.split('Bearer ')[1] || false;

  if (!token) {
    return res.status(403).json({ error: 'Unauthorized: No token received' });
  }

  if (tokens.includes(token)) {
    req.isJwt = false;
    req.tokenName = tokenNames.get(token) || null;
    req.tokenScope = tokenScopes[req.tokenName] ?? null;
    if (!routeAutorisee(req.tokenScope, req.path)) {
      return res.status(403).json({ error: 'Unauthorized: route hors du périmètre de ce jeton' });
    }
    return next();
  }

  // Jeton d'un client de l'API géré en base (`sgk_…`, cf. inc/auth/apiclients.js) :
  // même statut qu'un jeton de config.json, le nom du client tenant lieu de nom.
  try {
    const client = await resoudreToken(token);
    if (client) {
      req.isJwt = false;
      req.tokenName = client.nom;
      req.tokenScope = client.scopes;
      req.apiClientId = client.clientId;
      if (!routeAutorisee(req.tokenScope, req.path)) {
        return res.status(403).json({ error: 'Unauthorized: route hors du périmètre de ce jeton' });
      }
      return next();
    }
  } catch (err) {
    console.error('Résolution du jeton client :', err.message);
    return res.status(503).json({ error: 'Unauthorized: jeton client non vérifiable' });
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
