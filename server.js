// dependencies
import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import cors from 'cors';
import { setRequestContext } from './inc/request.js';

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
  editions
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


const allowedRaw = (process.env.ALLOWED_DOMAINS || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

// Build three sets : exact host:port, host-only (n'importe quel port),
// et wildcards de sous-domaine `*.domaine` (n'importe quel sous-domaine + apex)
const allowedExact = new Set();
const allowedHostOnly = new Set();
const allowedWildcard = []; // domaines de base, ex. 'sopress.com' pour '*.sopress.com'

for (const entry of allowedRaw) {
  if (entry.startsWith('*.')) {
    allowedWildcard.push(entry.slice(2));
  } else if (entry.includes(':')) {
    allowedExact.add(entry);
  } else {
    allowedHostOnly.add(entry);
  }
}

const matchesWildcard = (hostname) =>
  allowedWildcard.some((base) => hostname === base || hostname.endsWith(`.${base}`));

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser requests

    try {
      const { hostname, port } = new URL(origin);
      const key = port ? `${hostname}:${port}` : `${hostname}:443`;

      if (allowedExact.has(key) || allowedHostOnly.has(hostname) || matchesWildcard(hostname)) {
        return callback(null, true);
      }
    } catch (e) {
      // Invalid origin format
    }

    callback(new Error('Not allowed by CORS'));
  }
}));


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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Read the API documentation at: ${baseURL}/doc`);
});