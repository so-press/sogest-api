// index.js
import express from 'express';
import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { getUser } from './inc/users.js';

// Load environment variables
dotenv.config();

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config file
const config = JSON.parse(fs.readFileSync('./config/config.json'));
const tokens = Object.values(config.tokens);

// Create Express app
const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;


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

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const raw = req.headers['authorization'] || '';
  const token = raw.split('Bearer ')[1] || false;

  if (!token) {
    return res.status(403).json({ error: 'Unauthorized: No token received' });
  }

  if (tokens.includes(token)) {
    req.isJwt = false;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await getUser(decoded.id);
    req.isJwt = true;
    next();
  } catch (err) {
    console.log(err)
    return res.status(403).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Middleware to ensure the token is a valid JWT
const jwtOnlyMiddleware = (req, res, next) => {
  if (!req.isJwt) {
    return res.status(403).json({ error: 'Unauthorized: JWT required' });
  }
  next();
};

// Apply auth middleware globally
app.use(authMiddleware);

// Dynamically load all routes in ./routes
const routesDir = path.join(__dirname, 'routes');
const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));

// Import dynamically using top-level await workaround
  const loadRoutes = async () => {
    for (const file of routeFiles) {
      const routeModule = await import(`./routes/${file}`);
      const router = routeModule.default;
      const routePath = routeModule.routePath;
      const jwtOnly = routeModule.jwtOnly;
      if (!routePath) {
        console.warn(`No routePath specified in ${file}`);
        continue;
      }
      console.log({file, routePath})
      if (jwtOnly) {
        app.use(routePath, jwtOnlyMiddleware, router);
      } else {
        app.use(routePath, router);
      }
    }
  };

loadRoutes().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}).catch(err => {
  console.error('Error loading routes:', err);
});
