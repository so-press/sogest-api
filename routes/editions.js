import express from 'express';
import { listEditions, getEdition, resolveSupportId, diffuserEdition } from '../inc/editorial/editions.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/editions';

/**
 * @openapi
 * /editions:
 *   get:
 *     tags: [Editions]
 *     summary: Liste des éditions
 *     description: |
 *       Chaque édition porte `pdf`, l'URL complète de son fichier (sur S3, ou
 *       `uploads/editions/{id}.pdf` sur SOGEST tant qu'elle n'est pas migrée), et `fiche`, sa
 *       fiche dans SOGEST (envois par aiguillage), et `envoi`, son dernier envoi sur ses aiguillages
 *       (`{ le, serveurs, sur }`, `le` en heure de Paris « AAAA-MM-JJ HH:MM:SS », `null` si jamais
 *       envoyée). L'existence du fichier n'est pas
 *       vérifiée : c'est une URL déduite de l'édition.
 *     parameters:
 *       - { in: query, name: support, schema: { type: string }, description: Filtre sur le support (id numérique ou slug) }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [publication, modification, numero, id], default: publication }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *       - { in: query, name: page,  schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Liste paginée des éditions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:       { type: array, items: { type: object } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/', handleResponse(async (req, res) => {
  const { support, sort, order } = req.query;

  let supportId = null;
  if (support !== undefined && support !== '') {
    supportId = await resolveSupportId(support);
    if (supportId === null) {
      res.status(404);
      throw new Error('Support not found');
    }
  }

  return await listEditions({ supportId, sort, order });
}));

/**
 * @openapi
 * /editions/{id}:
 *   get:
 *     tags: [Editions]
 *     summary: Détails d'une édition
 *     description: |
 *       La réponse porte `pdf`, l'URL complète du fichier (S3, ou SOGEST tant qu'elle n'est pas migrée).
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Données de l'édition, content: { application/json: { schema: { type: object } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', handleResponse(async (req, res) => {
  const edition = await getEdition(parseInt(req.params.id, 10));
  if (!edition) {
    res.status(404);
    throw new Error('Edition not found');
  }
  return edition;
}));

/**
 * @openapi
 * /editions/diffusion:
 *   post:
 *     tags: [Editions]
 *     summary: Créer une édition PDF et l'envoyer sur ses aiguillages
 *     description: |
 *       Pendant de « Envoyer PDF » puis « Envoyer » dans SOGEST, appelé par So Librairie
 *       (bouton « Diffuser l'édition PDF ») : l'édition est créée avec **tous les aiguillages
 *       du support** et passe à l'état `ready` ; le cron de SOGEST l'envoie sur les FTP dans la
 *       minute. Sans aucun aiguillage, elle reste en préparation (`envoi` = `aucun_aiguillage`),
 *       rien n'est envoyé.
 *
 *       Le PDF n'est pas téléversé : `pdf_url` est une URL de téléchargement que SOGEST
 *       rapatrie avant l'envoi (elle doit rester valable quelques minutes ; un lien présigné
 *       de plusieurs heures convient).
 *
 *       SOGEST **ne génère jamais les pages** de ces éditions (`genpages` -1, `origine`
 *       `sogest-api`) : son bouton « Voir les pages » ouvre `solib_url`.
 *
 *       Une seule édition non supprimée par `solib_url`, et par support + numéro (numéro déjà
 *       envoyé depuis SOGEST) : 409 `edition_existante` (l'édition en place est jointe, rien
 *       n'est envoyé). Pour renvoyer, « Relancer » depuis la fiche SOGEST.
 *
 *       Réservée au **jeton applicatif statique** (403 `jeton_applicatif_requis` avec un JWT).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [support_id, numero, publication, pdf_url]
 *             properties:
 *               support_id:  { type: integer, description: Support SOGEST }
 *               numero:      { type: integer, description: Numéro (entier) }
 *               publication: { type: string, format: date, example: '2026-10-16', description: Date de publication (AAAA-MM-JJ) }
 *               pdf_url:     { type: string, format: uri, description: URL de téléchargement du PDF }
 *               fichier:     { type: string, description: 'Nom du fichier (50 caractères au plus, `.pdf` ajouté) ; défaut : « support-numéro.pdf »' }
 *               taille:      { type: integer, description: Taille du PDF en octets (corrigée par SOGEST au rapatriement) }
 *               solib_url:   { type: string, format: uri, description: Page du magazine dans So Librairie (« Voir les pages » de SOGEST) }
 *     responses:
 *       201:
 *         description: Édition créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 edition:     { type: object, description: L'édition créée (colonnes de la table editions, plus `pdf`) }
 *                 aiguillages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:             { type: integer }
 *                       serveur:        { type: string }
 *                       chemin:         { type: string }
 *                       decalage_jours: { type: integer, description: Envoi décalé de n jours sur la date de publication (nom du fichier) }
 *                 envoi:       { type: string, enum: [programme, aucun_aiguillage] }
 *                 sogest_url:  { type: string, format: uri, description: Fiche de l'édition dans SOGEST (suivi des envois) }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Jeton applicatif statique requis }
 *       409: { description: 'Édition déjà créée pour ce magazine (`edition_existante`, champs `edition` et `sogest_url` joints)' }
 */
router.post('/diffusion', handleResponse(async (req, res) => {
  // Appel de serveur à serveur (So Librairie) : une diffusion part sur les FTP des
  // partenaires, elle n'a pas à être déclenchable depuis un navigateur.
  if (req.isJwt !== false) {
    throw httpError(403, 'jeton_applicatif_requis', 'La diffusion d\'une édition est réservée au jeton applicatif statique.');
  }
  const resultat = await diffuserEdition(req.body || {});
  res.status(201);
  return resultat;
}));

export default router;
