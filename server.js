// GlitchTip : doit être chargé avant tout le reste
import { glitchtipActif, glitchtipUtilisateur, Sentry } from './instrument.js';

// dependencies
import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import cors from 'cors';
import { setRequestContext } from './inc/core/request.js';
import { httpError } from './inc/core/response.js';
import { compilerDomaines, domainesEnv } from './inc/core/cors.js';
import { origineAutoriseeEnBase } from './inc/auth/apiclients.js';

// routes
import * as absences from './routes/absences.js';
import * as documents from './routes/documents.js';
import * as login from './routes/login.js';
import * as personne from './routes/personne.js';
import * as personnes from './routes/personnes.js';
import * as users from './routes/users.js';
import * as notifications from './routes/notifications.js';
import * as upload from './routes/upload.js';
import * as historique from './routes/historique.js';
import * as trombinoscope from './routes/trombinoscope.js';
import * as ssoclients from './routes/ssoclients.js';
import * as supports from './routes/supports.js';
import * as equipes from './routes/equipes.js';
import * as editions from './routes/editions.js';
import * as ndf from './routes/ndf.js';
import * as projets from './routes/projets.js';
import * as activites from './routes/activites.js';
import * as devises from './routes/devises.js';
import * as endroits from './routes/endroits.js';
import * as reservations from './routes/reservations.js';
import * as mails from './routes/mails.js';
import * as applications from './routes/applications.js';
import * as groupesApplications from './routes/groupes_applications.js';
import * as apiclients from './routes/apiclients.js';

// middleware
import { jwtOnlyMiddleware } from './inc/middleware/jwt.js';
import { authMiddleware } from './inc/middleware/auth.js';

const routes = {
  absences,
  documents,
  login,
  personne,
  personnes,
  users,
  notifications,
  upload,
  historique,
  trombinoscope,
  ssoclients,
  supports,
  equipes,
  editions,
  ndf,
  projets,
  activites,
  devises,
  endroits,
  reservations,
  mails,
  applications,
  groupesApplications,
  apiclients
};

// Load environment variables
dotenv.config();

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Create Express app
const app = express();
app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl} (origin=${req.headers.origin || '-'})`);
  next();
});
app.use(express.json());
app.use(setRequestContext);
const port = process.env.PORT || 3000;
const baseURL = process.env.BASE_URL || `http://localhost:${port}`;


// Origines autorisées : ALLOWED_DOMAINS (historique, lu au démarrage) puis les
// domaines des clients de l'API gérés en base (cf. inc/auth/apiclients.js).
const origineAutoriseeEnv = compilerDomaines(domainesEnv());

// Même origine que l'API (la page /admin/ en POST/PUT/DELETE envoie un en-tête
// Origin) : toujours acceptée, quels que soient ALLOWED_DOMAINS.
const memeOrigine = (req, origin) => {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
};

const corsOptions = {
  // Sans ça le navigateur masque ces en-têtes au JS : le front ne pourrait pas
  // récupérer le nom de fichier renvoyé par /documents/:origin/:id/fichier, ni
  // pdf.js lire par plages le PDF relayé par /editions/:id/pdf.
  exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
};

app.use(cors(async (req, callback) => {
  const origin = req.headers.origin;
  // Requêtes hors navigateur, ou depuis l'API elle-même
  if (!origin || memeOrigine(req, origin)) return callback(null, { ...corsOptions, origin: true });

  if (origineAutoriseeEnv(origin) || await origineAutoriseeEnBase(origin)) {
    return callback(null, { ...corsOptions, origin: true });
  }

  callback(httpError(403, 'origine_non_autorisee', `Origine non autorisée (ALLOWED_DOMAINS ni clients de l'API) : ${origin}`));
}));

// Origine refusée : un 403 explicite plutôt que la page 500 par défaut d'Express.
// Le navigateur n'en laissera rien lire au JS (pas d'en-tête CORS), mais le code
// et l'origine en cause apparaissent dans l'onglet réseau et dans les logs.
app.use((err, req, res, next) => {
  if (err.errorCode !== 'origine_non_autorisee') return next(err);
  console.warn(`🚫 CORS : ${req.method} ${req.originalUrl} depuis ${req.headers.origin}`);
  res.status(403).json({ error: err.errorCode, message: err.message });
});


// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use('/doc', express.static(path.join(__dirname, 'doc')));
// Page d'administration des clients de l'API (connexion SSO en PKCE, puis
// appels à /api-clients avec le JWT obtenu) : statique, publique.
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Routes publiques (sans authentification) : un module de route peut exporter
// un `publicRouter` qui est monté avant `authMiddleware` sur son `routePath`.
for (const file in routes) {
  const route = routes[file];
  if (route.publicRouter && route.routePath) {
    app.use(route.routePath, route.publicRouter);
    console.log(`🔓 Public router mounted on ${route.routePath} (${file})`);
  }
}

// Apply auth middleware globally
app.use(authMiddleware);
app.use(glitchtipUtilisateur);

for (const file in routes) {
  if (!Object.hasOwn(routes, file)) continue;
  const route = routes[file];
  try {
    const router = route.default;
    const routePath = route.routePath;
    const requireAuth = route.requireAuth;
    if (!routePath) {
      console.warn(`⚠️ No routePath specified in ${file}`);
      continue;
    }
    // Un module `requireAuth` peut exposer un `tokenRouter` : ses routes sont
    // montées sans `jwtOnlyMiddleware`, donc ouvertes aussi au jeton applicatif
    // statique. Monté avant le routeur principal, qui sinon les capterait.
    if (route.tokenRouter) {
      app.use(routePath, route.tokenRouter);
      console.log(`🔑 Token router mounted on ${routePath} (${file})`);
    }
    if (requireAuth) {
      app.use(routePath, jwtOnlyMiddleware, router);
    } else {
      app.use(routePath, router);
    }
  } catch (err) {
    console.error(`❌ Failed to load route module: ${file}`);
    console.error('📄 Error message:', err.message);
    console.error('🧵 Stack trace:\n', err.stack);
    throw err;
  }
};

// Erreurs qui échappent à handleResponse (routes en flux, middlewares…) :
// signalées à GlitchTip quand elles sont en 5xx, puis rendues par Express.
if (glitchtipActif) Sentry.setupExpressErrorHandler(app);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Read the API documentation at: ${baseURL}/doc`);
});