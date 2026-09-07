import express from 'express';
import sharp from 'sharp';
import { AVATAR_SIZES, getUser, getUsers, getUserAvatar, setUserLink, getUserLinks, isReservedUserField, getUserCapabilities } from '../inc/rh/users.js';
import { getEquipesByUserId } from '../inc/rh/equipes.js';
import { handleResponse, httpError } from '../inc/core/response.js';
import { isUltraAdminRequest } from '../inc/core/access.js';
import {
    getTfaEtat, demarrerEnrolement, confirmerEnrolement, verifierCode,
    envoyerCodeSms, genererCodesSecours, confierAppareil, appareilDeConfiance,
    revoquerAppareils, reinitialiserTfa,
} from '../inc/rh/tfa.js';
import { jwtOnlyMiddleware } from '../inc/middleware/jwt.js';

const router = express.Router();
// Sous-routeur des endpoints publics (montés par server.js avant authMiddleware)
const publicRouter = express.Router();
// Base path for this router
export const routePath = '/users';


/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Liste des utilisateurs
 *     description: |
 *       Liste paginée des comptes actifs. `?recherche=` filtre sur le nom, le
 *       prénom, le nom complet et l'email : chaque mot doit correspondre, ce qui
 *       rend possible aussi bien « pontoire » que « gilles pontoire » ou
 *       « pontoire gilles ». Indispensable pour un sélecteur de personne, la
 *       liste complète dépassant les 3 700 comptes.
 *     parameters:
 *       - { in: query, name: recherche, schema: { type: string }, description: "Filtre sur nom / prénom / email" }
 *       - { in: query, name: page,      schema: { type: integer } }
 *       - { in: query, name: limit,     schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', handleResponse(async (req, res) => {
    const rows = await getUsers({ recherche: req.query.recherche || null });
    return rows;
}));

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Utilisateur correspondant au JWT
 *     description: |
 *       Renvoie l'utilisateur connecté (résolu depuis le JWT). **JWT obligatoire**
 *       (un token statique n'identifie pas d'utilisateur).
 *     security:
 *       - jwtAuth: []
 *     responses:
 *       200: { description: Utilisateur connecté, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', jwtOnlyMiddleware, handleResponse(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found for this token');
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return { ...req.user, personne: `${baseUrl}/personnes/${req.user.personne_id}` };
}));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Détails d'un utilisateur
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Informations de l'utilisateur, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
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
        personne: `${baseUrl}/personnes/${user.personne_id}`
    };
}));

/**
 * @openapi
 * /users/level/{level}:
 *   get:
 *     tags: [Users]
 *     summary: Utilisateurs par niveau d'accès
 *     parameters:
 *       - { in: path, name: level, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Utilisateurs correspondants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/level/:level', handleResponse(async (req, res) => {
    const rows = await getUsers({ level: req.params.level });
    return rows;
}));

/**
 * @openapi
 * /users/me/links/{champ}:
 *   put:
 *     tags: [Users]
 *     summary: Crée ou met à jour une meta (« link ») de l'utilisateur connecté
 *     description: |
 *       Upsert d'une valeur liée de l'utilisateur courant (table `links`,
 *       clé unique `champ`/`cle`/`table`). **JWT obligatoire** : l'utilisateur ne
 *       peut modifier que ses propres metas. Renvoie l'utilisateur à jour.
 *
 *       **Champs préfixés `_` (metas internes)** : un `champ` commençant par `_`
 *       est stocké normalement mais **n'est jamais fusionné** dans l'objet user
 *       renvoyé par les routes users (cette réponse, `GET /users`, `GET /users/:id`,
 *       réponse de login). Il reste lisible uniquement via `GET /users/:id/links`.
 *       Utiliser ce préfixe pour des metas qui ne doivent pas être exposées
 *       largement.
 *
 *       **Contraintes** :
 *       - le `champ` ne peut pas porter le nom d'une colonne de la table `users`
 *         (ex. `telephone`, `email`, `level`…) — sinon `400` (il écraserait la
 *         vraie valeur du user) ;
 *       - `libelle` est optionnel : posé à la création (`''` par défaut), et
 *         **laissé inchangé** lors d'un update s'il n'est pas fourni.
 *     security:
 *       - jwtAuth: []
 *     parameters:
 *       - { in: path, name: champ, required: true, schema: { type: string }, description: 'Nom de la meta (préfixe `_` = interne, non exposée dans l''objet user)' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [valeur]
 *             properties:
 *               valeur:  { type: string }
 *               libelle: { type: string, description: 'Libellé d''affichage (optionnel ; inchangé en base si omis lors d''un update)' }
 *     responses:
 *       200: { description: Utilisateur mis à jour, content: { application/json: { schema: { type: object } } } }
 *       400: { description: 'valeur manquante, ou champ réservé (= colonne de la table users)' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/me/links/:champ', jwtOnlyMiddleware, handleResponse(async (req, res) => {
    const champ = req.params.champ;
    const { valeur, libelle } = req.body || {};
    if (valeur === undefined) {
        res.status(400);
        throw new Error('valeur is required');
    }
    if (await isReservedUserField(champ)) {
        res.status(400);
        throw new Error(`champ "${champ}" est réservé (colonne de la table users)`);
    }

    await setUserLink(req.user.id, champ, valeur, libelle);
    return await getUser(req.user.id);
}));

/**
 * @openapi
 * /users/{id}/capabilities:
 *   get:
 *     tags: [Users]
 *     summary: Capacités d'un utilisateur
 *     description: |
 *       Renvoie l'objet `can` (mêmes champs que `user.can` du payload de login) :
 *       les capacités portées de sogest, dont `ultraAdmin` (compte admin **et**
 *       colonne `ultra_admin`) et `permanent` (compte admin, ou personne dont le
 *       contrat figure dans l'option sogest `CONTRATS_PERMANENTS`). Un utilisateur
 *       inconnu, inactif ou en corbeille renvoie toutes les capacités à `false`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Capacités de l'utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ultraAdmin: { type: boolean }
 *                 admin:      { type: boolean }
 *                 permanent:  { type: boolean }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/:id/capabilities', handleResponse(async (req) => {
    return await getUserCapabilities(req.params.id);
}));

/**
 * @openapi
 * /users/{id}/equipes:
 *   get:
 *     tags: [Users]
 *     summary: Équipes d'un utilisateur
 *     description: |
 *       Équipes visibles (hors corbeille) auxquelles l'utilisateur est rattaché,
 *       avec son `role` dans chacune. Même contenu que `GET /equipes/user`, mais
 *       pour un utilisateur désigné par son id : accessible au token applicatif.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des équipes de l'utilisateur (avec son `role`)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/:id/equipes', handleResponse(async (req) => {
    return await getEquipesByUserId(Number(req.params.id));
}));

/**
 * @openapi
 * /users/{id}/links:
 *   get:
 *     tags: [Users]
 *     summary: Liste des metas (« links ») d'un utilisateur
 *     description: |
 *       Renvoie **toutes** les valeurs liées de l'utilisateur, **y compris** les
 *       champs internes préfixés `_`.
 *
 *       À noter : les champs `_` ne sont volontairement **pas** fusionnés dans
 *       l'objet user des autres routes (`GET /users`, `GET /users/:id`, login,
 *       réponse du PUT meta) ; cette route est le **seul** endroit qui les expose.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des metas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       champ:   { type: string }
 *                       valeur:  { type: string }
 *                       libelle: { type: string }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/:id/links', handleResponse(async (req) => {
    return await getUserLinks(req.params.id, { includeInternal: true });
}));


/* ------------------------------------------------------------------ */
/* Authentification forte (2FA)                                        */
/* ------------------------------------------------------------------ */

/**
 * Les endpoints 2FA manipulent du matériel d'authentification : ils sont
 * réservés aux appels machine de confiance (jeton statique — c'est le SSO qui
 * mène le parcours) et aux ultra admins. Un JWT d'utilisateur ordinaire ne peut
 * donc pas cibler le compte d'un tiers, ni éprouver ses codes.
 */
function exigerAccesTfa(req) {
    if (!isUltraAdminRequest(req)) {
        throw httpError(403, 'non_habilite', 'Accès réservé au SSO et aux ultra admins.');
    }
}

/**
 * @openapi
 * /users/{id}/tfa:
 *   get:
 *     tags: [Users]
 *     summary: État de l'authentification forte d'un utilisateur
 *     description: |
 *       Dit si le compte **doit** une 2FA (`requise`), pourquoi (`raison` :
 *       `ultra_admin`, `reglage_compte`, `option_globale`, `exempte`,
 *       `non_active`), s'il est déjà enrôlé et par quel moyen. La règle est
 *       calculée par sogest et n'est jamais dupliquée côté SSO.
 *
 *       Ne renvoie aucun secret : le numéro de téléphone est masqué.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: État 2FA du compte
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requise:     { type: boolean }
 *                 obligatoire: { type: boolean, description: "Ultra admin : exigée quel que soit le réglage" }
 *                 raison:      { type: string }
 *                 reglage:     { type: string, enum: [oui, non, defaut] }
 *                 enrole:      { type: boolean }
 *                 methode:     { type: string, nullable: true, enum: [app, sms] }
 *                 methodes:    { type: array, items: { type: string } }
 *                 telephone:   { type: string, nullable: true, description: "Masqué" }
 *                 codesSecoursRestants: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Réservé au SSO et aux ultra admins }
 */
router.get('/:id/tfa', handleResponse(async (req) => {
    exigerAccesTfa(req);
    return await getTfaEtat(req.params.id);
}));

/**
 * @openapi
 * /users/{id}/tfa/enroll:
 *   post:
 *     tags: [Users]
 *     summary: Démarre un enrôlement 2FA
 *     description: |
 *       Pour `app`, renvoie l'URI `otpauth://` que l'appelant transforme en QR
 *       code. Pour `sms`, envoie immédiatement un premier code.
 *
 *       L'enrôlement n'est effectif qu'après `POST /tfa/enroll/confirm` : un
 *       parcours abandonné ne verrouille jamais un compte.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [methode]
 *             properties:
 *               methode:   { type: string, enum: [app, sms] }
 *               telephone: { type: string, description: "Mobile saisi quand le profil n'en porte pas ; il n'est recopié dans `users.telephone` qu'une fois prouvé par un code reçu" }
 *     responses:
 *       200: { description: "Enrôlement démarré (otpauth pour `app`, numéro masqué pour `sms`)" }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { description: Réservé au SSO et aux ultra admins }
 */
router.post('/:id/tfa/enroll', handleResponse(async (req) => {
    exigerAccesTfa(req);
    const methode = req.body?.methode;
    if (!['app', 'sms'].includes(methode)) {
        throw httpError(400, 'methode_invalide', 'La méthode doit être "app" ou "sms".');
    }
    try {
        return await demarrerEnrolement(req.params.id, methode, req.body?.telephone ?? null);
    } catch (err) {
        throw httpError(400, 'enrolement_impossible', err.message);
    }
}));

/**
 * @openapi
 * /users/{id}/tfa/enroll/confirm:
 *   post:
 *     tags: [Users]
 *     summary: Confirme l'enrôlement et délivre les codes de secours
 *     description: |
 *       Valide un premier code produit par le moyen enrôlé. En cas de succès,
 *       renvoie les 8 codes de secours **en clair, une seule fois** : la base
 *       n'en conserve que le haché. À afficher à l'utilisateur immédiatement.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200: { description: "Enrôlement confirmé, codes de secours renvoyés" }
 *       400: { description: "Code invalide, ou enrôlement déjà confirmé" }
 */
router.post('/:id/tfa/enroll/confirm', handleResponse(async (req) => {
    exigerAccesTfa(req);
    const resultat = await confirmerEnrolement(req.params.id, req.body?.code);
    if (!resultat.ok) throw httpError(400, resultat.erreur, 'Code invalide.');
    return resultat;
}));

/**
 * @openapi
 * /users/{id}/tfa/challenge:
 *   post:
 *     tags: [Users]
 *     summary: Envoie un code par SMS
 *     description: |
 *       Deux envois consécutifs sont espacés d'une minute (`trop_tot` renvoie le
 *       nombre de secondes à attendre). Le code n'est stocké que haché.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "SMS envoyé (numéro masqué)" }
 *       429: { description: "Renvoi trop rapproché" }
 */
router.post('/:id/tfa/challenge', handleResponse(async (req, res) => {
    exigerAccesTfa(req);
    const resultat = await envoyerCodeSms(req.params.id);
    if (!resultat.ok) {
        if (resultat.erreur === 'trop_tot') {
            res.status(429);
            throw httpError(429, 'trop_tot', `Merci de patienter ${resultat.attendre} secondes.`);
        }
        throw httpError(400, resultat.erreur, "Impossible d'envoyer le code par SMS.");
    }
    return resultat;
}));

/**
 * @openapi
 * /users/{id}/tfa/verify:
 *   post:
 *     tags: [Users]
 *     summary: Vérifie un code 2FA
 *     description: |
 *       Accepte un code TOTP, un code reçu par SMS ou un code de secours à usage
 *       unique. Après 5 échecs consécutifs, le compte est verrouillé 15 minutes
 *       (`erreur: "bloque"`) — c'est ce qui rend un code à 6 chiffres non
 *       énumérable.
 *
 *       `confier: true` enregistre l'appareil pour 30 jours et renvoie le jeton
 *       à déposer en cookie. La base n'en garde que le haché : le cookie n'est
 *       pas forgeable.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:    { type: string }
 *               confier: { type: boolean }
 *               libelle: { type: string, description: "User-agent, pour identifier l'appareil" }
 *               ip:      { type: string }
 *     responses:
 *       200: { description: "Code validé" }
 *       400: { description: "Code invalide" }
 *       429: { description: "Compte temporairement verrouillé" }
 */
router.post('/:id/tfa/verify', handleResponse(async (req, res) => {
    exigerAccesTfa(req);

    const resultat = await verifierCode(req.params.id, req.body?.code);
    if (!resultat.ok) {
        const status = resultat.erreur === 'bloque' ? 429 : 400;
        res.status(status);
        throw httpError(status, resultat.erreur, resultat.erreur === 'bloque'
            ? 'Trop de tentatives : réessayez plus tard.'
            : 'Code invalide.');
    }

    if (req.body?.confier) {
        resultat.appareil = await confierAppareil(req.params.id, {
            libelle: req.body?.libelle,
            ip: req.body?.ip,
        });
    }

    return resultat;
}));

/**
 * @openapi
 * /users/{id}/tfa/device:
 *   post:
 *     tags: [Users]
 *     summary: Vérifie un jeton d'appareil de confiance
 *     description: |
 *       Dit si le jeton porté par le cookie du SSO dispense ce compte de saisir
 *       un code. Marque l'appareil comme utilisé et purge les jetons expirés.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jeton]
 *             properties:
 *               jeton: { type: string }
 *     responses:
 *       200: { description: "{ confiance: boolean }" }
 */
router.post('/:id/tfa/device', handleResponse(async (req) => {
    exigerAccesTfa(req);
    return { confiance: await appareilDeConfiance(req.params.id, req.body?.jeton) };
}));

/**
 * @openapi
 * /users/{id}/tfa/codes:
 *   post:
 *     tags: [Users]
 *     summary: Régénère les codes de secours
 *     description: |
 *       Renvoie 8 nouveaux codes en clair (une seule fois) et invalide les
 *       précédents.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "Nouveaux codes de secours" }
 */
router.post('/:id/tfa/codes', handleResponse(async (req) => {
    exigerAccesTfa(req);
    return { codesSecours: await genererCodesSecours(req.params.id) };
}));

/**
 * @openapi
 * /users/{id}/tfa:
 *   delete:
 *     tags: [Users]
 *     summary: Réinitialise l'authentification forte d'un compte
 *     description: |
 *       Perte de téléphone : efface le secret, les codes de secours et les
 *       appareils de confiance. L'utilisateur devra se ré-enrôler à sa prochaine
 *       connexion. Réservé au SSO et aux ultra admins.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "2FA réinitialisée" }
 *       403: { description: Réservé au SSO et aux ultra admins }
 */
router.delete('/:id/tfa', handleResponse(async (req) => {
    exigerAccesTfa(req);
    return await reinitialiserTfa(req.params.id);
}));

/**
 * @openapi
 * /users/{id}/tfa/devices:
 *   delete:
 *     tags: [Users]
 *     summary: Révoque tous les appareils de confiance d'un compte
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ revoques: N }" }
 */
router.delete('/:id/tfa/devices', handleResponse(async (req) => {
    exigerAccesTfa(req);
    return { revoques: await revoquerAppareils(req.params.id) };
}));

/**
 * @openapi
 * /users/{id}/avatar:
 *   get:
 *     tags: [Users]
 *     summary: Avatar (image binaire) d'un utilisateur
 *     description: |
 *       Endpoint **public** (aucune authentification). Renvoie le contenu binaire de
 *       l'avatar redimensionné carré (cover). Si Gravatar renvoie 404, bascule sur
 *       l'image définie par `DEFAULT_AVATAR`.
 *     security: []
 *     parameters:
 *       - { in: path,  name: id,   required: true, schema: { type: integer } }
 *       - in: query
 *         name: size
 *         required: false
 *         schema: { type: string, enum: [small, medium, big], default: medium }
 *         description: small=64px, medium=128px, big=256px
 *     responses:
 *       200:
 *         description: Image binaire
 *         content:
 *           image/*:
 *             schema: { type: string, format: binary }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
async function safeFetch(url, timeoutMs = 5000) {
    if (!url) return null;
    try {
        return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        console.warn(`avatar fetch failed for ${url}: ${err.message}`);
        return null;
    }
}

publicRouter.get('/:id/avatar', async (req, res) => {
    try {
        console.log(`Fetching avatar for user ${req.params.id}`);
        const user = await getUser(req.params.id);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const size = AVATAR_SIZES[req.query.size] ? req.query.size : 'medium';
        const px = AVATAR_SIZES[size];

        let url = await getUserAvatar(user, size);
        let upstream = await safeFetch(url);

        if ((!upstream || !upstream.ok) && process.env.DEFAULT_AVATAR && url !== process.env.DEFAULT_AVATAR) {
            url = process.env.DEFAULT_AVATAR;
            upstream = await safeFetch(url);
        }

        if (!upstream || !upstream.ok) {
            res.status(404).json({ error: 'Avatar not found' });
            return;
        }

        const inputBuf = Buffer.from(await upstream.arrayBuffer());
        const { data, info } = await sharp(inputBuf)
            .resize(px, px, { fit: 'cover' })
            .toBuffer({ resolveWithObject: true });

        res.set('Content-Type', `image/${info.format}`);
        res.send(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error', message: '' + err });
    }
});

export { publicRouter };
export default router;

