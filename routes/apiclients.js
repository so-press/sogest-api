import express from 'express';
import { jwtVerify } from 'jose';
import { buildUserSession, getSsoJwks } from './login.js';
import { getUserByEmail } from '../inc/rh/users.js';
import {
  ajouterDomaine, configHistorique, creerClient, creerToken, getClient, listerClients,
  modifierClient, revoquerToken, supprimerClient, supprimerDomaine,
} from '../inc/auth/apiclients.js';
import { isUltraAdminRequest } from '../inc/core/access.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
// Connexion de la page /admin/ : montée sans authentification (cf. server.js).
const publicRouter = express.Router();
export const routePath = '/api-clients';
// JWT seulement : un jeton applicatif ne gère pas les jetons applicatifs.
export const requireAuth = true;

/**
 * Client OIDC de la page /admin/, **distinct** de celui des fronts
 * (`SSO_AUDIENCE` n'est pas concerné) :
 * - `ADMIN_SSO_CLIENT_ID` — client public (PKCE, sans secret) ; obligatoire,
 *   sans lui la connexion admin est désactivée ;
 * - `ADMIN_SSO_ISSUER`, `ADMIN_SSO_JWKS_URI` — par défaut `SSO_ISSUER` et
 *   `SSO_JWKS_URI`.
 */
function adminSsoConfig() {
  const clientId = (process.env.ADMIN_SSO_CLIENT_ID || '').trim();
  const issuer = process.env.ADMIN_SSO_ISSUER || process.env.SSO_ISSUER;
  const jwksUri = process.env.ADMIN_SSO_JWKS_URI || process.env.SSO_JWKS_URI;
  if (!clientId || !issuer || !jwksUri) {
    throw httpError(503, 'admin_sso_non_configure',
      'Connexion admin non configurée (ADMIN_SSO_CLIENT_ID, et ADMIN_SSO_ISSUER / ADMIN_SSO_JWKS_URI ou SSO_ISSUER / SSO_JWKS_URI)');
  }
  return { clientId, issuer, jwksUri };
}

/**
 * @openapi
 * /api-clients/auth/config:
 *   get:
 *     tags: [API Clients]
 *     summary: Configuration OIDC de la page /admin/
 *     description: |
 *       **Public.** Client OIDC dédié à la page d'administration
 *       (`ADMIN_SSO_CLIENT_ID`, `ADMIN_SSO_ISSUER`), indépendant de `SSO_AUDIENCE`.
 *     security: []
 *     responses:
 *       200:
 *         description: Paramètres OIDC
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authority: { type: string }
 *                 client_id: { type: string }
 *                 scope:     { type: string }
 *       503: { description: "`admin_sso_non_configure`" }
 */
publicRouter.get('/auth/config', handleResponse(async () => {
  const { clientId, issuer } = adminSsoConfig();
  return { authority: issuer, client_id: clientId, scope: 'openid profile email' };
}));

/**
 * @openapi
 * /api-clients/auth/sso:
 *   post:
 *     tags: [API Clients]
 *     summary: Connexion à la page /admin/
 *     description: |
 *       **Public.** Échange un `id_token` émis pour `ADMIN_SSO_CLIENT_ID` contre
 *       un JWT sogest (même réponse que `POST /login`), **réservé aux ultra admins**.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_token]
 *             properties:
 *               id_token: { type: string }
 *     responses:
 *       200: { description: Session créée }
 *       400: { description: "`id_token_manquant`" }
 *       401: { description: "`id_token_invalide`" }
 *       403: { description: "`utilisateur_inconnu`, `non_habilite`" }
 *       503: { description: "`admin_sso_non_configure`" }
 */
publicRouter.post('/auth/sso', handleResponse(async (req) => {
  const { clientId, issuer, jwksUri } = adminSsoConfig();
  const idToken = req.body?.id_token;
  if (!idToken) throw httpError(400, 'id_token_manquant', 'id_token requis');

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, getSsoJwks(jwksUri), { issuer, audience: clientId }));
  } catch (e) {
    throw httpError(401, 'id_token_invalide', `id_token invalide : ${e.message}`);
  }

  const user = claims.email ? await getUserByEmail(claims.email) : null;
  if (!user) throw httpError(403, 'utilisateur_inconnu', 'Aucun utilisateur sogest pour ce compte SSO');

  const session = await buildUserSession(user);
  if (!session.user.can?.ultraAdmin) {
    throw httpError(403, 'non_habilite', `${user.nom || claims.email} n'est pas ultra admin`);
  }
  return session;
}));

export { publicRouter };

// Réservé aux ultra admins (administration transverse).
router.use((req, res, next) => {
  if (!isUltraAdminRequest(req)) {
    return res.status(403).json({ error: 'non_habilite', message: 'Réservé aux ultra admins' });
  }
  next();
});

const idParam = (v, nom = 'id') => {
  const id = parseInt(v, 10);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'id_invalide', `${nom} invalide`);
  return id;
};

/**
 * @openapi
 * components:
 *   schemas:
 *     ApiClient:
 *       type: object
 *       properties:
 *         id:          { type: integer }
 *         nom:         { type: string, description: "Identifiant lisible ; tient lieu de nom de jeton (`req.tokenName`)" }
 *         description: { type: string }
 *         actif:       { type: boolean, description: "Inactif : jetons et domaines ignorés" }
 *         scopes:
 *           type: object
 *           nullable: true
 *           description: "Même sens que `tokenScopes` dans config.json ; null = non restreint"
 *           properties:
 *             routes:  { type: array, items: { type: string }, example: ['/equipes'] }
 *             equipes: { type: array, items: { type: integer } }
 *         cree_le:     { type: string }
 *         modifie_le:  { type: string, nullable: true }
 *         tokens:      { type: array, items: { $ref: '#/components/schemas/ApiClientToken' } }
 *         domaines:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:      { type: integer }
 *               domaine: { type: string, example: '*.sopress.com' }
 *     ApiClientToken:
 *       type: object
 *       description: Jeton d'un client — jamais en clair (seul son préfixe est exposé)
 *       properties:
 *         id:            { type: integer }
 *         libelle:       { type: string }
 *         prefixe:       { type: string, example: 'sgk_Ab12Cd34' }
 *         cree_le:       { type: string }
 *         expire_le:     { type: string, nullable: true }
 *         dernier_usage: { type: string, nullable: true, description: "Mis à jour au plus toutes les 5 minutes" }
 *         revoque_le:    { type: string, nullable: true }
 *         etat:          { type: string, enum: [actif, expire, revoque] }
 *
 * /api-clients:
 *   get:
 *     tags: [API Clients]
 *     summary: Liste des clients de l'API
 *     description: |
 *       Clients gérés en base, avec leurs jetons (sans valeur) et leurs domaines
 *       CORS autorisés. **Ultra admin, JWT seulement.**
 *
 *       Ces clients s'ajoutent à la configuration historique (`config.json →
 *       tokens` et `ALLOWED_DOMAINS`), toujours acceptée : voir
 *       `GET /api-clients/historique`.
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200:
 *         description: Liste paginée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { $ref: '#/components/schemas/ApiClient' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`non_habilite`" }
 *   post:
 *     tags: [API Clients]
 *     summary: Créer un client
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom]
 *             properties:
 *               nom:         { type: string }
 *               description: { type: string }
 *               actif:       { type: boolean, default: true }
 *               scopes:      { type: object, nullable: true }
 *     responses:
 *       200: { description: Client créé, content: { application/json: { schema: { $ref: '#/components/schemas/ApiClient' } } } }
 *       400: { description: "`nom_invalide`, `scopes_invalides`" }
 *       409: { description: "`nom_existant` (y compris un nom de jeton de config.json)" }
 */
router.get('/', handleResponse(async () => listerClients()));

router.post('/', handleResponse(async (req) => creerClient(req.body || {}, req.user?.id)));

/**
 * @openapi
 * /api-clients/historique:
 *   get:
 *     tags: [API Clients]
 *     summary: Configuration historique (lecture seule)
 *     description: |
 *       Ce qui reste accepté en dehors de la base : noms des jetons de
 *       `config.json` (jamais leur valeur) avec leurs `tokenScopes`, et entrées
 *       de `ALLOWED_DOMAINS`. Se modifie sur le serveur, pas par l'API.
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200:
 *         description: Configuration historique
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tokens:   { type: array, items: { type: object, properties: { nom: { type: string }, scopes: { type: object, nullable: true } } } }
 *                 domaines: { type: array, items: { type: string } }
 */
router.get('/historique', handleResponse(async () => configHistorique()));

/**
 * @openapi
 * /api-clients/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: integer } }
 *   get:
 *     tags: [API Clients]
 *     summary: Détail d'un client
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Client, content: { application/json: { schema: { $ref: '#/components/schemas/ApiClient' } } } }
 *       404: { description: "`client_inconnu`" }
 *   put:
 *     tags: [API Clients]
 *     summary: Modifier un client
 *     description: Seuls les champs fournis sont modifiés. `scopes` à `null` lève toute restriction.
 *     security:
 *       - jwtAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nom:         { type: string }
 *               description: { type: string }
 *               actif:       { type: boolean }
 *               scopes:      { type: object, nullable: true }
 *     responses:
 *       200: { description: Client modifié, content: { application/json: { schema: { $ref: '#/components/schemas/ApiClient' } } } }
 *       404: { description: "`client_inconnu`" }
 *       409: { description: "`nom_existant`" }
 *   delete:
 *     tags: [API Clients]
 *     summary: Supprimer un client
 *     description: Mise en corbeille ; tous ses jetons sont révoqués.
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Supprimé }
 *       404: { description: "`client_inconnu`" }
 */
router.get('/:id', handleResponse(async (req) => getClient(idParam(req.params.id))));

router.put('/:id', handleResponse(async (req) => modifierClient(idParam(req.params.id), req.body || {})));

router.delete('/:id', handleResponse(async (req) => supprimerClient(idParam(req.params.id))));

/**
 * @openapi
 * /api-clients/{id}/tokens:
 *   post:
 *     tags: [API Clients]
 *     summary: Générer un jeton
 *     description: |
 *       Le jeton (`sgk_…`) n'est renvoyé **qu'ici, une seule fois** : seul son
 *       haché SHA-256 est conservé. Il s'utilise comme un jeton de config.json :
 *       `Authorization: Bearer sgk_…`.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               libelle:   { type: string, example: 'prod' }
 *               expire_le: { type: string, format: date, description: "Valable jusqu'à la fin de ce jour ; absent = sans expiration" }
 *     responses:
 *       200:
 *         description: Jeton créé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: Le jeton en clair — à conserver maintenant }
 *                 jeton: { $ref: '#/components/schemas/ApiClientToken' }
 *       400: { description: "`date_invalide`" }
 *       404: { description: "`client_inconnu`" }
 */
router.post('/:id/tokens', handleResponse(async (req) =>
  creerToken(idParam(req.params.id), req.body || {}, req.user?.id)));

/**
 * @openapi
 * /api-clients/{id}/tokens/{tokenId}:
 *   delete:
 *     tags: [API Clients]
 *     summary: Révoquer un jeton
 *     description: Le jeton est refusé dès la requête suivante (sur ce processus ; 60 s au plus sur les autres).
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: tokenId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Révoqué }
 *       404: { description: "`jeton_inconnu`" }
 */
router.delete('/:id/tokens/:tokenId', handleResponse(async (req) =>
  revoquerToken(idParam(req.params.id), idParam(req.params.tokenId, 'tokenId'))));

/**
 * @openapi
 * /api-clients/{id}/domaines:
 *   post:
 *     tags: [API Clients]
 *     summary: Autoriser une origine CORS
 *     description: |
 *       Même syntaxe qu'une entrée de `ALLOWED_DOMAINS` : `host` (tout port),
 *       `host:port`, ou `*.domaine` (sous-domaines et apex). Un schéma ou un
 *       chemin saisis par erreur sont retirés.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domaine]
 *             properties:
 *               domaine: { type: string, example: 'app.example.com' }
 *     responses:
 *       200: { description: Domaine ajouté }
 *       400: { description: "`domaine_invalide`" }
 *       409: { description: "`domaine_existant`" }
 */
router.post('/:id/domaines', handleResponse(async (req) =>
  ajouterDomaine(idParam(req.params.id), req.body?.domaine)));

/**
 * @openapi
 * /api-clients/{id}/domaines/{domaineId}:
 *   delete:
 *     tags: [API Clients]
 *     summary: Retirer une origine CORS
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: path, name: domaineId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Retiré }
 *       404: { description: "`domaine_inconnu`" }
 */
router.delete('/:id/domaines/:domaineId', handleResponse(async (req) =>
  supprimerDomaine(idParam(req.params.id), idParam(req.params.domaineId, 'domaineId'))));

export default router;
