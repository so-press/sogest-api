import express from 'express';
import { envoyerMail, mailConfig } from '../inc/core/mail.js';
import { handleResponse, httpError } from '../inc/core/response.js';

const router = express.Router();
export const routePath = '/mails';

const vrai = (v) => ['1', 'true', 'yes', 'oui'].includes(String(v).toLowerCase());

/**
 * Relais d'envoi réservé au **jeton applicatif statique**.
 *
 * C'est l'inverse de `requireAuth` : ici le JWT est refusé, parce qu'une route
 * qui expédie du courrier au nom de l'entreprise n'a pas à être joignable
 * depuis un navigateur. Un front qui doit envoyer un mail passe par son
 * backend, qui détient le jeton.
 */
function assertJetonApplicatif(req) {
  if (req.isJwt !== false) {
    throw httpError(403, 'jeton_applicatif_requis',
      "L'envoi d'e-mails est réservé au jeton applicatif statique : un JWT utilisateur n'est pas accepté ici.");
  }
}

/** Traduit les erreurs de validation du helper en erreurs HTTP. */
function valider(err) {
  const codes400 = [
    'destinataire_manquant', 'destinataire_invalide', 'sujet_manquant', 'contenu_manquant',
    'piece_jointe_invalide', 'pieces_jointes_trop_lourdes', 'piece_jointe_injoignable',
    'provider_inconnu',
  ];
  if (err.code && codes400.includes(err.code)) return httpError(400, err.code, err.message);
  return err;
}

/**
 * @openapi
 * /mails/config:
 *   get:
 *     tags: [Mails]
 *     summary: État de la configuration d'envoi
 *     description: |
 *       Ce qu'un outil appelant peut vérifier avant de se demander pourquoi ses
 *       mails ne partent pas : fournisseur retenu, clés présentes ou non,
 *       expéditeur par défaut, redirection active. **Aucune clé n'est exposée.**
 *
 *       Réservé au jeton applicatif statique, comme l'envoi lui-même.
 *     responses:
 *       200:
 *         description: Configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 provider:     { type: string, enum: [brevo, mailjet], description: "Fournisseur essayé en premier" }
 *                 fallback:     { type: boolean, description: "Bascule vers l'autre fournisseur en cas d'échec" }
 *                 fournisseurs:
 *                   type: object
 *                   description: "Fournisseurs dont les clés sont configurées"
 *                   properties:
 *                     brevo:   { type: boolean }
 *                     mailjet: { type: boolean }
 *                 from:         { type: object, properties: { email: { type: string }, nom: { type: string } } }
 *                 bcc:          { type: string, nullable: true, description: "Copie cachée systématique d'archivage" }
 *                 redirection:
 *                   type: object
 *                   description: "Garde-fou des environnements de test"
 *                   properties:
 *                     actif:     { type: boolean }
 *                     vers:      { type: string }
 *                     etiquette: { type: string }
 *                 taille_max_pieces_jointes_mo: { type: number }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`jeton_applicatif_requis`" }
 */
router.get('/config', handleResponse(async (req) => {
  assertJetonApplicatif(req);
  return mailConfig();
}));

/**
 * @openapi
 * /mails:
 *   post:
 *     tags: [Mails]
 *     summary: Envoie un e-mail transactionnel
 *     description: |
 *       Passe le message au prestataire et raconte comment l'envoi s'est
 *       déroulé : quel fournisseur a servi, l'identifiant qu'il a rendu, ce qui
 *       a réellement été expédié, et le détail de chaque tentative.
 *
 *       **Deux fournisseurs**, comme sogest : Brevo d'abord, Mailjet en secours
 *       si le premier refuse (`MAIL_FALLBACK=0` désactive la bascule, ou
 *       `provider` l'impose pour cet envoi). Un échec des deux renvoie **502**
 *       avec le détail de chaque tentative — le corps a la même forme qu'un
 *       succès, `ok` valant `false`.
 *
 *       **Corps du message** : `html` et/ou `texte`, ou bien `message` seul —
 *       auquel cas il est interprété comme dans sogest (s'il contient des
 *       balises c'est du HTML, et la version texte en est dérivée ; sinon
 *       l'inverse).
 *
 *       **Pièces jointes** : `{contenu, nom, type}` en base64, ou `{url}`
 *       téléchargée par l'API (jamais déléguée au fournisseur, pour que les
 *       limites soient les mêmes partout). Taille cumulée plafonnée par
 *       `MAIL_MAX_ATTACHMENT_MB`.
 *
 *       **Redirection** : si `MAIL_REDIRECT_TO` est posée (environnements de
 *       test), tout part vers cette seule adresse, sujet préfixé et bandeau
 *       rappelant les destinataires réels — la réponse le signale dans
 *       `redirection`. Utilisez `GET /mails/config` pour savoir si c'est le cas.
 *
 *       **Habilitation** : jeton applicatif statique **uniquement** ; un JWT
 *       utilisateur est refusé (`jeton_applicatif_requis`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, sujet]
 *             properties:
 *               to:
 *                 description: "Destinataire(s) : une adresse, une chaîne séparée par des virgules, un objet `{email, nom}`, ou un tableau"
 *                 oneOf:
 *                   - { type: string }
 *                   - { type: array, items: { oneOf: [ { type: string }, { type: object, properties: { email: { type: string }, nom: { type: string } } } ] } }
 *               cc:           { description: "Copie, même format que `to`" }
 *               bcc:          { description: "Copie cachée, même format que `to`" }
 *               sujet:        { type: string, description: "Alias : `subject`" }
 *               html:         { type: string }
 *               texte:        { type: string, description: "Alias : `text`" }
 *               message:      { type: string, description: "Corps unique, HTML ou texte détecté automatiquement" }
 *               from:         { description: "Expéditeur (`MAIL_FROM` par défaut) : adresse ou `{email, nom}`" }
 *               from_nom:     { type: string }
 *               reply_to:     { description: "Adresse de réponse (l'expéditeur par défaut)" }
 *               reply_to_nom: { type: string }
 *               pieces_jointes:
 *                 type: array
 *                 description: "Alias : `attachments`"
 *                 items:
 *                   type: object
 *                   properties:
 *                     nom:     { type: string, description: "Obligatoire avec `contenu`" }
 *                     type:    { type: string, description: "Type MIME ; déduit du nom ou de la réponse HTTP si absent" }
 *                     contenu: { type: string, description: "Contenu en base64" }
 *                     url:     { type: string, description: "Alternative à `contenu` : l'API télécharge le fichier" }
 *               entetes:      { type: object, description: "En-têtes SMTP supplémentaires. Alias : `headers`" }
 *               provider:     { type: string, enum: [brevo, mailjet], description: "Impose le fournisseur (et désactive la bascule)" }
 *               simuler:      { type: boolean, description: "Valide et renvoie ce qui serait envoyé, sans rien expédier" }
 *     responses:
 *       200:
 *         description: Message accepté par le fournisseur
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EnvoiMail' }
 *       400: { description: "`destinataire_manquant`, `destinataire_invalide`, `sujet_manquant`, `contenu_manquant`, `piece_jointe_invalide`, `pieces_jointes_trop_lourdes`, `piece_jointe_injoignable` ou `provider_inconnu`" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "`jeton_applicatif_requis`" }
 *       502:
 *         description: "Aucun fournisseur n'a accepté le message — `tentatives` dit pourquoi"
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EnvoiMail' }
 */
router.post('/', handleResponse(async (req, res) => {
  assertJetonApplicatif(req);

  let resultat;
  try {
    resultat = await envoyerMail(req.body || {}, { simuler: vrai(req.body?.simuler) });
  } catch (err) {
    throw valider(err);
  }

  // Un refus des deux fournisseurs n'est pas une erreur de l'appelant : on
  // renvoie le même corps qu'un succès, avec le détail de chaque tentative.
  if (!resultat.ok) res.status(502);
  return resultat;
}));

export default router;
