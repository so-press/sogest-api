import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const docDir = path.join(projectRoot, 'doc');

// swagger-jsdoc utilise `glob` qui n'apprécie pas les chemins absolus Windows
// (les "\\" sont interprétés comme des échappements). On bascule donc le cwd
// sur la racine du projet pour pouvoir passer une glob relative portable.
process.chdir(projectRoot);

const spec = swaggerJsdoc({
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'SOGEST API',
            version: '1.0.0',
            description: 'API REST sogest (Express). Authentification par token (JWT utilisateur ou token applicatif statique).',
        },
        // URL relative : Scalar (et tout viewer OpenAPI standard) résout cette URL
        // contre l'origin de la page qui sert la doc. Du coup `/doc` sur prod tape
        // vers prod, `/doc` en local tape vers local — sans regen au déploiement.
        servers: [
            { url: '/', description: 'Serveur courant (origin de la doc)' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    description: "Token JWT utilisateur **ou** token applicatif statique (`config.json → tokens`). Format : `Authorization: Bearer <token>`.",
                },
                jwtAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: "Token JWT utilisateur uniquement. Les tokens applicatifs statiques sont refusés sur ces endpoints.",
                },
            },
            responses: {
                Unauthorized: {
                    description: 'Token manquant ou invalide',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                NotFound: {
                    description: 'Ressource introuvable',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
                BadRequest: {
                    description: 'Requête invalide',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        message: { type: 'string' },
                    },
                },
                Pagination: {
                    type: 'object',
                    properties: {
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                        totalPages: { type: 'integer' },
                    },
                },
            },
        },
        security: [{ bearerAuth: [] }],
    },
    apis: ['routes/*.js'],
});

fs.mkdirSync(docDir, { recursive: true });
fs.writeFileSync(path.join(docDir, 'openapi.json'), JSON.stringify(spec, null, 2));

const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SOGEST API — Référence</title>
</head>
<body>
  <script id="api-reference" data-url="./openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(docDir, 'index.html'), html);

const nbPaths = spec.paths ? Object.keys(spec.paths).length : 0;
const nbOps = spec.paths
    ? Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0)
    : 0;
console.log(`✅ doc/openapi.json (${nbPaths} paths, ${nbOps} opérations) + doc/index.html`);
