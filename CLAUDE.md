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
- `ALLOWED_DOMAINS` — comma-separated list of allowed CORS origins (e.g. `localhost:5173,app.example.com`)
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`
- `NO_PASSWORD_NEEDED` — set to any truthy value to bypass bcrypt check (dev only)

`config/config.json` (not committed, use `config.json.modele` as template) holds:
- `tokens` — named static API tokens (bypass JWT, allow all non-JWT-only routes)
- `allowedFileTypes` — MIME types accepted by the upload route

## Architecture

This is an Express REST API using ES modules (`"type": "module"`). Entry point is `server.js`.

### Route registration

Each file in `routes/` must export:
- `default` — an Express Router instance
- `routePath` — string, the base URL path (e.g. `'/personnes'`)
- `requireAuth` — boolean (optional); if true, the route additionally requires a valid JWT (not just a static token)

`server.js` iterates `routes` and mounts each router automatically. No manual registration needed.

### Two-layer authentication

All requests require an `Authorization: Bearer <token>` header (`authMiddleware` in `inc/middleware/auth.js`):

1. **Static token** — matches a value in `config/config.json → tokens`. Sets `req.isJwt = false`.
2. **JWT** — verified against `JWT_SECRET`. Sets `req.user` (full user object) and `req.isJwt = true`.

Routes with `export const requireAuth = true` additionally run `jwtOnlyMiddleware`, which blocks static-token requests. Use this for user-specific mutations.

### Response pattern

All route handlers are wrapped with `handleResponse()` from `inc/response.js`:
- Return a plain object → sent as JSON
- Return an array → automatically paginated using `?page=` and `?limit=` query params (default limit 50)
- `meta` fields that are JSON strings are automatically parsed
- Throw an error after setting `res.status(...)` to return that status with `{ error, message }`

### Database access

Two clients coexist:
- `mysql2/promise` pool — used in `inc/` helpers via direct SQL queries and `QueryBuilder` (`inc/query_builder.js`)
- `knex` (`db.js`) — available for more complex query building

`QueryBuilder` is a thin wrapper that accumulates `AND` conditions and an `ORDER BY` clause before building a parameterized SQL string.

### `inc/` helpers

Each domain has a helper file (`inc/personnes.js`, `inc/users.js`, etc.) that encapsulates the DB queries. Routes import from these helpers rather than querying the DB directly.

`inc/request.js` exposes `getRequest()` via `AsyncLocalStorage` so any helper can access the current request without passing it explicitly.

### File upload

`POST /upload` (JWT required) uploads files to S3-compatible storage. File types are validated against `config.json → allowedFileTypes`. Uploading a file that already exists returns HTTP 409.

### API documentation

Inline `@api` JSDoc comments in `routes/` and `inc/` are compiled by `apidoc` into `doc/` (served at `/doc`). Run `npm run docs` after adding or changing endpoint docs.
