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

- `inc/core/` — transverse infra, no domain logic: `response.js`, `request.js`, `query_builder.js`, `utils.js`, `sogest.js`, `access.js`, `options.js`
- `inc/auth/` — `ssoclients.js` (SSO clients). The auth/JWT request middleware lives separately in `inc/middleware/`.
- `inc/rh/` — `users.js`, `personnes.js`, `equipes.js`, `absences.js`, `absences_historique.js`, `contrats.js`
- `inc/editorial/` — `supports.js`, `editions.js`, `projets.js`, `activites.js`, `piges.js`, `mahalo.js`, `calendrier.js`
- `inc/ndf/` — `ndf.js`, `devises.js`
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

### File upload

`POST /upload` (JWT required) uploads files to S3-compatible storage. File types are validated against `config.json → allowedFileTypes`. Uploading a file that already exists returns HTTP 409.

### API documentation

Inline `@openapi` JSDoc comments (YAML) in `routes/*.js` are compilés en OpenAPI 3.0 par `swagger-jsdoc` via `tools/gen-docs.js`. La sortie est `doc/openapi.json` + un `doc/index.html` qui charge le viewer **Scalar** depuis le CDN. `doc/` est servi statiquement sur `/doc`. Run `npm run docs` after adding or changing endpoint docs.

Les schémas de sécurité (`bearerAuth` = JWT ou token statique, `jwtAuth` = JWT obligatoire) et les réponses communes (`Unauthorized`, `NotFound`, `BadRequest`) sont définis dans `tools/gen-docs.js` et référencés via `$ref`.
