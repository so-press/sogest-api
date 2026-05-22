import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();

export const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Renvoie les colonnes DATE/DATETIME en chaînes ('YYYY-MM-DD') plutôt qu'en
    // objets Date convertis en UTC (évite le décalage d'un jour côté client).
    dateStrings: true
  }
});

// Test de connexion immédiat
db.raw('SELECT 1')
  .then(() => {
    console.log('✅ Database connection established.');
  })
  .catch((err) => {
    console.error('❌ Database connection failed!');
    process.exit(1); // Arrêt du serveur si la base est inaccessible
  });
