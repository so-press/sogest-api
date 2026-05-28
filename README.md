# sogest-api

API REST (Express, ES modules) qui expose les données de Sogest : personnes, équipes, supports, éditions, absences, notes de frais, documents, SSO clients, etc.

## Prérequis

- **Node.js** ≥ 18 (ES modules, `fetch` natif)
- **MySQL / MariaDB** avec la base `sogest`
- Un **stockage S3** (DigitalOcean Spaces ou compatible) pour les uploads

## Dépendances principales

- **express** — serveur HTTP / routing
- **mysql2** + **knex** — accès base de données
- **jsonwebtoken** + **jose** — authentification JWT et échange OpenID Connect (SSO)
- **multer**, **@aws-sdk/client-s3**, **sharp** — upload de fichiers vers S3 et traitement d'images
- **dayjs**, **cors**, **dotenv**, **bcrypt**, **csv-parse**
- _dev_ : **nodemon** (hot-reload), **swagger-jsdoc** (génération de la doc)

## Installation

```bash
git clone <repo> sogest-api
cd sogest-api
npm install
```

Créez ensuite les deux fichiers de configuration (non versionnés) :

1. **`.env`** — connexion base de données, JWT, S3, CORS, SSO. La liste complète
   des variables et leur signification est documentée dans [`CLAUDE.md`](./CLAUDE.md#environment).
2. **`config/config.json`** — copiez le modèle puis adaptez-le :

   ```bash
   cp config/config.json.modele config/config.json
   ```

   Il contient les tokens d'API statiques (`tokens`) et les types MIME autorisés
   à l'upload (`allowedFileTypes`).

## Lancement

```bash
npm run dev      # nodemon, hot-reload (routes/, inc/, server.js)
npm start        # sans hot-reload
```

Le serveur écoute sur le port défini par `PORT` (3000 par défaut).

## Documentation de l'API

Deux ressources complémentaires décrivent les endpoints disponibles :

- **Swagger / Scalar** — documentation OpenAPI générée depuis les commentaires
  `@openapi` des fichiers `routes/*.js`. Servie sur **`/doc`** une fois le serveur
  lancé (ex. <http://localhost:3000/doc>). Régénérez-la après modification des
  commentaires avec :

  ```bash
  npm run docs
  ```

- **Collection Bruno** — le dossier [`bruno/`](./bruno) contient une collection
  prête à l'emploi ([Bruno](https://www.usebruno.com/)) avec des exemples de
  requêtes pour chaque ressource, des environnements préconfigurés
  (`Local`, `Recette`, `Prod`) et le chaînage des identifiants. Ouvrez le dossier
  `bruno/` dans Bruno pour commencer.

## Authentification

La plupart des requêtes attendent un header `Authorization: Bearer <token>` :

- **token statique** (défini dans `config/config.json`) pour les accès machine ;
- **JWT** (signé avec `JWT_SECRET`) pour les accès utilisateur. Les routes
  marquées `requireAuth` n'acceptent **que** le JWT.

Le JWT s'obtient soit par `POST /login` (email / mot de passe), soit via le SSO
OpenID Connect :

- `GET /login/config` — **public**, renvoie `{ authority, scope }` pour que le
  front construise son client OIDC (pas de `client_id` exposé) ;
- `POST /login/sso` — **public**, échange un `id_token` SSO contre un JWT sogest.
  L'`aud` de l'`id_token` est validée contre le `client_id` transmis (allowlist
  `SSO_AUDIENCE`, ou motif `sogest-<slug>`).

Voir [`CLAUDE.md`](./CLAUDE.md) pour les détails d'architecture (enregistrement
des routes, double authentification, flux SSO, format des réponses, accès base de
données).
