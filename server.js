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
  trombinoscope
};

// Load environment variables
dotenv.config();

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Create Express app
const app = express();
app.use(express.json());
app.use(setRequestContext);
const port = process.env.PORT || 3000;
const baseURL = process.env.BASE_URL || `http://localhost:${port}`;


const allowedRaw = (process.env.ALLOWED_DOMAINS || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

// Build two sets: one for exact host:port, one for wildcard hosts
const allowedExact = new Set();
const allowedHostOnly = new Set();

for (const entry of allowedRaw) {
  if (entry.includes(':')) {
    allowedExact.add(entry);
  } else {
    allowedHostOnly.add(entry);
  }
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser requests

    try {
      const { hostname, port } = new URL(origin);
      const key = port ? `${hostname}:${port}` : `${hostname}:443`;

      if (allowedExact.has(key) || allowedHostOnly.has(hostname)) {
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
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use('/doc', express.static(path.join(__dirname, 'doc')));


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