# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start with nodemon (watches routes/, inc/, server.js)
npm start        # Start without hot-reload
npm run docs     # Regenerate API documentation from JSDoc in routes/
```

There are no tests. No linter is configured.

## Environment

Copy `.env` from a template (not committed). Required variables:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — MySQL connection
- `JWT_SECRET`, `JWT_EXPIRATION` (default `7d`)
- `PORT` (default 3000), `BASE_URL`
- `ALLOWED_DOMAINS` — comma-separated list of allowed CORS origins. Each entry is a host (no scheme): `host` matches any port, `host:port` matches that exact port, and `*.domain` matches any subdomain of `domain` (and the apex). E.g. `localhost:5173,app.example.com,*.sopress.com`
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`
- `NO_PASSWORD_NEEDED` — set to any truthy value to bypass bcrypt check (dev only)
- `SSO_ISSUER`, `SSO_JWKS_URI` — OpenID Connect provider used by `POST /login/sso`
- `MAHALO_URL`, `MAHALO_TOKEN` — API Mahalo Grabber (calendriers de parution), voir plus bas
- `ASK_URL`, `PDF_TO_IMAGE_URL` — services maison utilisés par la lecture des
  justificatifs de notes de frais (défauts : `https://tools.sopress.dev/ask/` et
  `https://tools.sopress.dev/pdf-to-image/v2/`), voir plus bas
- `MAIL_PROVIDER` (`brevo` | `mailjet`), `BREVO_API_KEY` (clé **e-mails**, distincte de
  `BREVO_SMS_API_KEY`), `MAILJET_KEY`, `MAILJET_SECRET`, `MAIL_FROM`,
  `MAIL_FROM_NAME`, `MAIL_BCC`, `MAIL_FALLBACK`, `MAIL_REDIRECT_TO`, `MAIL_ENV`,
  `MAIL_MAX_ATTACHMENT_MB` — envoi d'e-mails, voir plus bas
- `SSO_AUDIENCE` — comma-separated allowlist of `client_id`s accepted when exchanging an id_token (= expected `aud`). The first entry is the default audience when the front sends no `client_id`. Any `client_id` matching `sogest-<slug>` is also accepted, regardless of this list.

`config/config.json` (not committed, use `config.json.modele` as template) holds:
- `tokens` — named static API tokens (bypass JWT, allow all non-JWT-only routes)
- `tokenScopes` — optional per-token restrictions, keyed by token **name**. Only
  `{ "equipes": [...] }` today: it limits which teams that static token may write
  to (`POST`/`DELETE /equipes/:id/membres`). A token absent from `tokenScopes` is
  unrestricted, and reads are never restricted.
- `allowedFileTypes` — MIME types accepted by the upload route

## Architecture

This is an Express REST API using ES modules (`"type": "module"`). Entry point is `server.js`.

### Route registration

Each file in `routes/` must export:
- `default` — an Express Router instance
- `routePath` — string, the base URL path (e.g. `'/personnes'`)
- `requireAuth` — boolean (optional); if true, the route additionally requires a valid JWT (not just a static token)
- `publicRouter` — optional Router mounted **before** `authMiddleware`: its routes need no token at all (logos de supports)
- `tokenRouter` — optional Router mounted after `authMiddleware` but **without** `jwtOnlyMiddleware`: the exception that lets a few routes of a `requireAuth` module accept a static token (`POST /ndf/depenses/:id/detection`, appelée par sogest)

`server.js` iterates over a `routes` object and mounts each router (applying `jwtOnlyMiddleware` first when `requireAuth` is true). When adding a new route file, you must import it at the top of `server.js` and add it to that `routes` object — the directory is not auto-scanned.

### Two-layer authentication

All requests require an `Authorization: Bearer <token>` header (`authMiddleware` in `inc/middleware/auth.js`):

1. **Static token** — matches a value in `config/config.json → tokens`. Sets `req.isJwt = false`.
2. **JWT** — verified against `JWT_SECRET`. Sets `req.user` (full user object) and `req.isJwt = true`.

Routes with `export const requireAuth = true` additionally run `jwtOnlyMiddleware`, which blocks static-token requests. Use this for user-specific mutations.

### Access scoping (`inc/core/access.js`)

Two helpers decide whether a request may look beyond its own perimeter:

- `isAdminRequest(req)` — static token, or JWT user with `level === 'admin'` or the `ultra_admin` column. Used by the editorial routes to bypass per-user filtering.
- `isUltraAdminRequest(req)` — static token, or JWT user with `level === 'admin'` **and** the `ultra_admin` column. Gates the transverse admin features: `GET /absences/historique/tous`, and targeting another user on `/absences` (query `userId`, body `user_id`, and `PUT`/`DELETE` on someone else's absence — see `cibleUserId()` in `routes/absences.js`).

Membership writes (`POST /equipes/:id/membres`, `DELETE
/equipes/:id/membres/:userId`) accept a static token (within its `tokenScopes`
perimeter), an admin JWT, or the JWT of a `manager` of that team. They are
recorded in `historique` under table `lien_equipe_user` with `cle` = the team id
— that table has no primary key, so `saveToHistorique()` cannot be used and the
event itself is stored instead. Under a static token the caller may name the
author with `auteur_user_id` (body) or the `X-Auteur-User-Id` header, which
accept either the sogest `users.id` or the SSO `sub` (`spc-sogest_{id}`).

Business errors on these routes use `httpError(status, code, message)` from
`inc/core/response.js`: `error` then carries a stable code (`membre_existant`,
`equipe_inconnue`, `non_habilite`…) instead of the exception message.

`req.user` is the `users` row reloaded by `authMiddleware`, **not** the JWT payload: read the `ultra_admin` column, not `can.ultraAdmin` (which only exists in the login payload).

### SSO login (`POST /login/sso`)

Exchanges an OpenID Connect `id_token` (signed by `SSO_ISSUER`, verified against `SSO_JWKS_URI`) for a sogest JWT, returning the same payload as `POST /login`. Called with a static token (the user has no JWT yet).

The body is `{ id_token, client_id? }`. The token's `aud` is validated against the expected audience:
- `client_id` provided **and** allowed (in `SSO_AUDIENCE` allowlist **or** matching `sogest-<slug>`) → expected `aud` = that `client_id`.
- `client_id` provided but not allowed → **403** (before any signature check).
- `client_id` omitted → expected `aud` = first entry of `SSO_AUDIENCE` (backward-compatible default).

Never trust the incoming `client_id` blindly: the allowlist/pattern check is what prevents an id_token issued for a different client of the same SSO from being accepted here.

### Response pattern

All route handlers are wrapped with `handleResponse()` from `inc/response.js`:
- Return a plain object → sent as JSON
- Return an array → automatically paginated using `?page=` and `?limit=` query params (default limit 50)
  - Add `?count=1` (or `count=true`) to get **only** the `pagination` object (with `total`), without the `data` array. Native on every list route, no per-route code. Note: `total` is the row count of the returned array (not a SQL `COUNT(*)`, and not value-weighted).
- `meta` fields that are JSON strings are automatically parsed
- Throw an error after setting `res.status(...)` to return that status with `{ error, message }`

### Database access

Two clients coexist:
- `mysql2/promise` pool — used in `inc/` helpers via direct SQL queries and `QueryBuilder` (`inc/core/query_builder.js`)
- `knex` (`db.js`) — available for more complex query building

`QueryBuilder` is a thin wrapper that accumulates `AND` conditions and an `ORDER BY` clause before building a parameterized SQL string.

### `inc/` helpers

Each domain has a helper file that encapsulates the DB queries. Routes import from these helpers rather than querying the DB directly. Helpers are grouped into thematic subfolders mirroring the OpenAPI `x-tagGroups` and the Bruno collection:

- `inc/core/` — transverse infra, no domain logic: `response.js`, `request.js`, `query_builder.js`, `utils.js`, `sogest.js`, `access.js`, `options.js`, `ask.js`, `pdf.js`, `sms.js`, `mail.js`
- `inc/auth/` — `ssoclients.js` (SSO clients). The auth/JWT request middleware lives separately in `inc/middleware/`.
- `inc/rh/` — `users.js`, `personnes.js`, `equipes.js`, `absences.js`, `absences_historique.js`, `contrats.js`
- `inc/editorial/` — `supports.js`, `editions.js`, `projets.js`, `activites.js`, `piges.js`, `mahalo.js`, `calendrier.js`
- `inc/office/` — `endroits.js`, `reservations.js`, `planning.js`
- `inc/ndf/` — `ndf.js`, `devises.js`, `detection.js`
- `inc/systeme/` — `documents.js`, `historique.js`, `notifications.js`

Cross-folder imports are normal (e.g. `inc/ndf/ndf.js` pulls `../editorial/supports.js`, `../rh/personnes.js`, `./devises.js`). The `db` client is imported as `../../db.js` from any helper.

`inc/core/request.js` exposes `getRequest()` via `AsyncLocalStorage` so any helper can access the current request without passing it explicitly.

### Calendrier de parution (Mahalo)

`GET /supports/calendrier` (tous supports, ou `?supportId=`) et son pendant
`GET /supports/:id/calendrier` renvoient un calendrier **unifié** : les items viennent
de l'API [Mahalo Grabber](https://utils.sopress.dev/mahalo/doc) (calendriers de
parution collectés sur Mahalo, servis depuis un cache fichier alimenté par un
cron quotidien), les activités viennent de sogest. Chaque item est toujours
présent, qu'une activité lui corresponde ou non.

- `inc/editorial/mahalo.js` — client HTTP (`MAHALO_URL` + `MAHALO_TOKEN`), cache
  mémoire 1 h (1 min sur erreur), table de transcodage `support_id` → `refTitre`,
  conversion des dates UTC de Mahalo en dates civiles `Europe/Paris`.
- `inc/editorial/calendrier.js` — rapprochement items ↔ activités.

**La notion de « titre » Mahalo ne sort jamais de `mahalo.js`** : tout est
adressé côté API par `support_id` sogest, la transco est résolue en interne. Un
support sans correspondance arbitrée (`sogest_id: null` dans `GET /api/transco`)
ou géré « date à date » chez Mahalo n'apporte simplement aucun item — ce n'est
pas une erreur.

Rapprochement en deux passes, une activité ne pouvant être rattachée qu'à un seul
item : d'abord `activites.numero` = `noParution`, puis, pour les items restés
orphelins, les activités dont `date_bouclage` tombe dans la période de parution.
Le champ `rapprochement` vaut `numero`, `dates` ou `null`, et `activites` est
toujours un tableau (un numéro peut porter plusieurs activités).

### Réservation des endroits

Un « endroit » n'est pas forcément un lieu : salle de réunion, salle de montage,
mais aussi du **matériel** (caméras, trépieds…).

Ces routes ouvrent la réservation **à d'autres outils** — ce n'est pas une
migration de [the-office](../the-office), qui continue d'appeler l'API legacy de
sogest (`endroits`, `reservation`, `annuler-reservation`). Les deux écrivent
dans les mêmes tables (`endroits`, `reservations`) : les règles métier
ci-dessous sont donc reprises à l'identique de `include/auto/endroits.inc.php`,
et toute divergence se verrait immédiatement dans les plannings partagés.

- `GET/POST/PUT/DELETE /endroits` — référentiel. Les écritures sont réservées
  aux admins (`isAdminRequest`), la suppression est une mise en corbeille.
  `GET /endroits/{id}` accepte l'id **ou le slug**.
- `GET /endroits/types`, `GET /endroits/grille` — les constantes d'affichage
  (types, jours ouvrés, pas de 30 min de 08:00 à 21:00, créneaux matin /
  après-midi / journée).
- `GET /endroits/{id}/planning?semaine=` — la semaine prête à dessiner : jours
  datés, grille horaire, navigation de semaine en semaine (numéros ISO) et
  réservations de la période. C'est le remplaçant des champs `date` / `heures` /
  `jours` / `creneaux` que la route legacy collait sur **chaque** endroit.
- `GET /endroits/{id}/disponibilite` — libre maintenant, ou sur une plage
  donnée (la réponse liste alors les réservations qui la bloquent).
- `PUT /endroits/{id}/ecran` — les écrans posés devant les salles s'annoncent
  eux-mêmes (pendant de `endroit.php?slug=…&ip=…`). **L'image de l'écran reste
  générée par sogest** (GD) : l'API n'en expose que l'URL (champ `ecran`).
- `GET/POST/PUT/DELETE /reservations` — les réservations. Modifier ou annuler
  est réservé au titulaire ou à un admin ; l'annulation est une mise en
  corbeille. L'état précédent est versionné dans `historique`.

Règles métier reprises de sogest :

- la plage se donne au choix par `fin`, `duree` (`01:30`) ou `creneau`
  (`matin`, `apres-midi`, `journee`) ;
- le **chevauchement** est refusé (`creneau_occupe`, 409, la réponse listant les
  réservations en cause) ; deux créneaux qui se touchent ne se gênent pas ;
- un endroit rattaché à une équipe (`id_equipe`) n'est réservable que par ses
  membres (`equipe_requise`), les ultra admins passant outre ; un endroit fermé
  ne l'est par personne (`endroit_ferme`) ;
- réserver **au nom d'un autre** (`user_id`) demande d'être admin ;
- `couleur1` / `couleur2` sont recalculées comme sogest (`crc32` de l'id
  utilisateur), pour que les deux applications affichent les mêmes couleurs.

`/reservations` accepte le JWT **et** le jeton applicatif statique — mais le
jeton doit alors désigner l'utilisateur pour le compte de qui il agit
(`auteur_user_id` ou `X-Auteur-User-Id`, comme les écritures sur `/equipes`),
sinon **401 `utilisateur_requis`** : une réservation appartient toujours à
quelqu'un.

Non repris : l'**envoi automatique des notifications** aux `emails_dest` d'un
endroit (`notif`) lorsqu'une réservation est posée. Les champs restent exposés
et modifiables, et l'envoi lui-même est désormais possible via `POST /mails`
(voir plus bas) — mais aucune route de réservation ne le déclenche d'elle-même :
côté sogest, c'est toujours lui qui notifie.

### Envoi d'e-mails

`POST /mails` relaie un e-mail transactionnel chez un prestataire et **raconte
comment l'envoi s'est déroulé** : quel fournisseur a servi, l'identifiant qu'il
a rendu, ce qui a réellement été expédié, et le détail de chaque tentative.
`GET /mails/config` expose l'état de la configuration (sans jamais de clé), pour
qu'un outil puisse vérifier son terrain avant de s'étonner.

`inc/core/mail.js` est le pendant de `inc/core/sms.js` : **Brevo d'abord,
Mailjet en secours**, comme `smtp_sendmail()` dans sogest. Deux fournisseurs
parce qu'un service d'envoi peut être suspendu du jour au lendemain (quota,
réputation, validation de compte) : garder le second câblé évite que tout ce qui
dépend de l'e-mail s'arrête avec lui. `MAIL_FALLBACK=0` désactive la bascule,
`provider` l'impose pour un envoi donné.

- le corps se donne par `html` et/ou `texte`, ou par `message` seul — interprété
  comme dans sogest : des balises ⇒ HTML (la version texte en est dérivée),
  sinon texte (la version HTML est échappée) ;
- les pièces jointes sont acceptées en base64 (`{contenu, nom}`) ou par URL
  (`{url}`). **L'URL est téléchargée par l'API**, jamais déléguée au
  fournisseur : Mailjet ne sait pas le faire, et le faire nous-mêmes garantit le
  même résultat et les mêmes limites (`MAIL_MAX_ATTACHMENT_MB`, 10 Mo cumulés)
  quel que soit celui qui envoie. Un chemin de fichier local n'est **pas**
  accepté, contrairement à sogest : l'appelant est distant ici, ce serait lui
  offrir la lecture du disque du serveur ;
- `simuler: true` valide tout et renvoie ce qui *serait* envoyé, sans rien
  expédier. C'est la façon de tester une intégration sans écrire à personne ;
- un refus des deux fournisseurs renvoie **502** avec le même corps qu'un
  succès (`ok: false`), `tentatives` disant ce qu'a répondu chacun.

**`MAIL_REDIRECT_TO` est le garde-fou des environnements de test** : tant
qu'elle est posée, tout part vers cette seule adresse, sujet préfixé de
`MAIL_ENV` et bandeau rappelant les destinataires réels (même principe que
`brevo_env()` dans sogest). La réponse le signale dans `redirection`. **À vider
en production**, sinon plus aucun mail n'atteint son destinataire.

Cette route est **réservée au jeton applicatif statique** : un JWT utilisateur
est refusé (`jeton_applicatif_requis`). C'est l'inverse de `requireAuth`, et il
n'y a pas de mécanisme générique pour ça — le contrôle est fait dans la route
(`assertJetonApplicatif()`). Une route qui expédie du courrier au nom de
l'entreprise n'a pas à être joignable depuis un navigateur : un front qui doit
envoyer un mail passe par son backend, qui détient le jeton.

Les envois **ne sont pas journalisés** en base : la réponse HTTP est la seule
trace, à charge de l'appelant de la conserver s'il en a besoin.

### Lecture des justificatifs de notes de frais

`POST /ndf/depenses/{id}/detection` soumet le justificatif d'une dépense à
l'API « ask » (`inc/core/ask.js`) et renvoie ce qui a pu en être lu : `nature`,
`etablissement`, `date_depense`, `ht`, `tva`, `ttc`, `devise`. `inc/ndf/detection.js` porte le
prompt et les règles de sogest (`include/auto/ndf.inc.php`) :

- **le modèle ne fait que lire.** Le montant de TVA ne lui est jamais demandé ;
  il est calculé à partir de ce qui est imprimé (HT + TTC, ou l'un des deux avec
  le taux). Un TTC inférieur au HT fait abandonner les trois montants ;
- un justificatif **PDF est d'abord rendu en image** (`inc/core/pdf.js`), c'est
  sa première page qui est lue ;
- la devise lue est validée contre les devises connues de l'application.

Les six champs sont lus en **une seule requête**, là où sogest en fait une par
champ : mesuré sur douze justificatifs réels, à montants identiques et à latence
égale (les appels unitaires étant parallèles), pour quatre fois moins de
requêtes. Une seconde lecture, ciblée sur le seul taux de TVA, n'a lieu que s'il
manque un montant que ce taux permettrait de reconstituer.

La dépense n'est complétée que sur ses **champs vides** — `0.00` comptant comme
vide pour `ht`/`tva`/`ttc` — : une saisie de l'utilisateur n'est jamais écrasée.
`meta.detection_ia` mémorise le justificatif lu, marqueur que sogest utilise
pour ne pas relancer sa propre détection.

`appliquer=0` n'écrit rien : la route ne fait que lire. C'est ainsi que sogest
l'appelle — **c'est la seule implémentation de la détection**, sogest ne lit plus
les justificatifs lui-même (`detecterChampJustif()` / `detecterMontantsJustif()`
y sont devenues de simples appels à cette route).

Un échec du service (indisponible, délai dépassé, refus du modèle) ne fait
jamais échouer la route : le champ concerné vaut simplement `null`.

Cette route est la seule de `/ndf` ouverte au **jeton applicatif statique**, que
sogest doit alors accompagner de l'utilisateur pour le compte de qui il agit
(`auteur_user_id` ou `X-Auteur-User-Id`) : le contrôle de propriété de la note de
frais porte sur cet utilisateur, il n'est jamais contourné. Le mécanisme est un
`tokenRouter` exporté par le module de route, pendant du `publicRouter` — cf.
« Route registration ».

### Authentification forte (2FA)

`inc/rh/tfa.js` est la **seule source de vérité** de l'authentification forte
des comptes sogest, au même titre que `getUserCapabilities` : la règle appartient
à sogest et n'est jamais dupliquée dans le SSO.

```
2FA exigée si  ultra admin                          (jamais désactivable)
           ou  link `tfa` = 'oui'
           ou  (link absent et option FORCER_TFA)
2FA levée  si  link `tfa` = 'non'                   (et pas ultra admin)
```

Le matériel secret ne sort jamais de l'API : secret TOTP chiffré AES-256-GCM
(`TFA_ENCRYPTION_KEY`), code SMS et codes de secours stockés hachés, jeton
d'appareil de confiance haché. Le SSO (`sso/lib/tfa.php`) ne fait qu'appeler
`/users/{id}/tfa/*` — il ne voit ni secret ni code.

Deux facteurs : TOTP (RFC 6238, fenêtre ±1 pas, anti-rejeu par mémorisation du
pas consommé) et SMS.

L'envoi SMS passe par `inc/core/sms.js`, indépendant du fournisseur :
`SMS_PROVIDER` vaut `brevo` (clé **dédiée aux SMS**, distincte de celle des
e-mails) ou `ovh` (jeton applicatif, requête signée SHA1). Deux implémentations
parce que l'émission SMS demande chez chaque opérateur une validation manuelle
du compte et de l'émetteur : pouvoir basculer évite d'être bloqué par l'un
d'eux. Les numéros sont normalisés en E.164 avant envoi — les deux API exigent
l'indicatif pays, et 2766 des 2902 numéros du parc sont au format national. Huit codes de secours à usage unique sont délivrés à
l'enrôlement, et cinq échecs consécutifs verrouillent le compte 15 minutes.

Tables : `users_tfa`, `users_tfa_codes`, `users_tfa_appareils` (`sql/users_tfa.sql`).

**`TFA_ENCRYPTION_KEY` est critique** : sans elle, aucun enrôlement n'est
possible, donc aucun ultra admin ne peut se connecter (le SSO refuse plutôt que
de laisser passer). Elle doit être posée AVANT tout déploiement, être différente
par environnement, et ne jamais changer une fois des comptes enrôlés — les
secrets deviendraient illisibles.

### File upload

`POST /upload` (JWT required) uploads files to S3-compatible storage. File types are validated against `config.json → allowedFileTypes`. Uploading a file that already exists returns HTTP 409.

### API documentation

Inline `@openapi` JSDoc comments (YAML) in `routes/*.js` are compilés en OpenAPI 3.0 par `swagger-jsdoc` via `tools/gen-docs.js`. La sortie est `doc/openapi.json` + un `doc/index.html` qui charge le viewer **Scalar** depuis le CDN. `doc/` est servi statiquement sur `/doc`. Run `npm run docs` after adding or changing endpoint docs.

Les schémas de sécurité (`bearerAuth` = JWT ou token statique, `jwtAuth` = JWT obligatoire) et les réponses communes (`Unauthorized`, `NotFound`, `BadRequest`) sont définis dans `tools/gen-docs.js` et référencés via `$ref`.
