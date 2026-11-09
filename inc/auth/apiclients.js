import crypto from 'crypto';
import fs from 'fs';
import { db } from '../../db.js';
import { compilerDomaines, domainesEnv, normaliserDomaine } from '../core/cors.js';
import { httpError } from '../core/response.js';

/**
 * Clients de l'API stockés en base (tables `api_clients`, `api_clients_tokens`,
 * `api_clients_domaines`, cf. sql/api_clients.sql).
 *
 * Ils complètent — sans le remplacer — le comportement historique :
 * `config/config.json → tokens` / `tokenScopes` et `ALLOWED_DOMAINS` restent
 * lus et acceptés. Un client en base se comporte comme un jeton statique :
 * `req.isJwt = false`, `req.tokenName` = son nom, `req.tokenScope` = ses scopes.
 *
 * Jetons : préfixe `sgk_` + 32 octets aléatoires. Seul le haché SHA-256 est
 * conservé ; le jeton en clair n'est rendu qu'une fois, à sa création.
 */

export const TOKEN_PREFIX = 'sgk_';
const CACHE_TTL_MS = 60 * 1000;
const USAGE_THROTTLE_MS = 5 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function lireConfig() {
  try {
    return JSON.parse(fs.readFileSync('./config/config.json'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Caches : la résolution d'un jeton et la liste des origines sont lues à
// chaque requête. Invalidés à chaque écriture, sinon rafraîchis toutes les 60 s
// (utile si plusieurs processus servent l'API).
// ---------------------------------------------------------------------------

const tokenCache = new Map(); // hash -> { value, at }
const derniersUsages = new Map(); // tokenId -> timestamp
let domainesCache = null; // { match, at }

export function invaliderCacheClients() {
  tokenCache.clear();
  domainesCache = null;
}

function parseScopes(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Résout un jeton applicatif en base.
 * @param {string} token
 * @returns {Promise<{tokenId:number, clientId:number, nom:string, scopes:Object|null}|null>}
 */
export async function resoudreToken(token) {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const hash = sha256(token);
  const now = Date.now();

  const cached = tokenCache.get(hash);
  let value;
  if (cached && now - cached.at < CACHE_TTL_MS) {
    value = cached.value;
  } else {
    const row = await db('api_clients_tokens as t')
      .join('api_clients as c', 'c.id', 't.client_id')
      .where('t.token_hash', hash)
      .whereNull('t.revoque_le')
      .where('c.actif', 1)
      .where('c.trash', 0)
      .where((q) => q.whereNull('t.expire_le').orWhere('t.expire_le', '>', db.fn.now()))
      .first('t.id as tokenId', 't.expire_le', 'c.id as clientId', 'c.nom', 'c.scopes');
    value = row
      ? { tokenId: row.tokenId, clientId: row.clientId, nom: row.nom, scopes: parseScopes(row.scopes), expire: row.expire_le }
      : null;
    tokenCache.set(hash, { value, at: now });
  }

  if (!value) return null;
  // L'expiration peut survenir pendant la durée de vie du cache.
  if (value.expire && new Date(value.expire.replace(' ', 'T')) <= new Date()) return null;

  const last = derniersUsages.get(value.tokenId) || 0;
  if (now - last > USAGE_THROTTLE_MS) {
    derniersUsages.set(value.tokenId, now);
    db('api_clients_tokens').where('id', value.tokenId).update({ dernier_usage: db.fn.now() })
      .catch((e) => console.warn('api_clients_tokens.dernier_usage :', e.message));
  }
  return value;
}

/**
 * L'origine est-elle autorisée par un client actif en base ?
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function origineAutoriseeEnBase(origin) {
  const now = Date.now();
  if (!domainesCache || now - domainesCache.at > CACHE_TTL_MS) {
    try {
      const rows = await db('api_clients_domaines as d')
        .join('api_clients as c', 'c.id', 'd.client_id')
        .where('c.actif', 1)
        .where('c.trash', 0)
        .select('d.domaine');
      domainesCache = { match: compilerDomaines(rows.map((r) => r.domaine)), at: now };
    } catch (e) {
      // Table absente (migration non jouée) ou base indisponible : on s'en tient
      // à ALLOWED_DOMAINS plutôt que de bloquer toutes les origines.
      console.warn('api_clients_domaines :', e.message);
      domainesCache = { match: () => false, at: now };
    }
  }
  return domainesCache.match(origin);
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const TOKEN_FIELDS = ['id', 'client_id', 'libelle', 'prefixe', 'cree_le', 'cree_par', 'expire_le', 'dernier_usage', 'revoque_le'];

function etatToken(t) {
  if (t.revoque_le) return 'revoque';
  if (t.expire_le && new Date(t.expire_le.replace(' ', 'T')) <= new Date()) return 'expire';
  return 'actif';
}

function formatClient(row, tokens = [], domaines = []) {
  return {
    ...row,
    actif: !!row.actif,
    scopes: parseScopes(row.scopes),
    tokens: tokens.map((t) => ({ ...t, etat: etatToken(t) })),
    domaines,
  };
}

/** @returns {Promise<Object[]>} clients non supprimés, avec jetons (sans haché) et domaines */
export async function listerClients() {
  const clients = await db('api_clients').where('trash', 0).orderBy('nom');
  if (!clients.length) return [];
  const ids = clients.map((c) => c.id);
  const [tokens, domaines] = await Promise.all([
    db('api_clients_tokens').whereIn('client_id', ids).orderBy('cree_le', 'desc').select(TOKEN_FIELDS),
    db('api_clients_domaines').whereIn('client_id', ids).orderBy('domaine').select('id', 'client_id', 'domaine', 'cree_le'),
  ]);
  return clients.map((c) => formatClient(
    c,
    tokens.filter((t) => t.client_id === c.id),
    domaines.filter((d) => d.client_id === c.id),
  ));
}

export async function getClient(id) {
  const c = await db('api_clients').where({ id, trash: 0 }).first();
  if (!c) throw httpError(404, 'client_inconnu', `Client ${id} introuvable`);
  const [tokens, domaines] = await Promise.all([
    db('api_clients_tokens').where('client_id', id).orderBy('cree_le', 'desc').select(TOKEN_FIELDS),
    db('api_clients_domaines').where('client_id', id).orderBy('domaine').select('id', 'client_id', 'domaine', 'cree_le'),
  ]);
  return formatClient(c, tokens, domaines);
}

/** Valide `{routes, equipes}` ; `null`/vide = non restreint. */
function validerScopes(scopes) {
  if (scopes === undefined || scopes === null || scopes === '') return null;
  if (typeof scopes !== 'object' || Array.isArray(scopes)) {
    throw httpError(400, 'scopes_invalides', 'scopes doit être un objet {routes?, equipes?}');
  }
  const out = {};
  if (scopes.routes != null) {
    if (!Array.isArray(scopes.routes)) throw httpError(400, 'scopes_invalides', 'scopes.routes doit être un tableau');
    const routes = scopes.routes.map((r) => String(r).trim()).filter(Boolean)
      .map((r) => (r.startsWith('/') ? r : `/${r}`).replace(/\/+$/, ''));
    if (routes.length) out.routes = [...new Set(routes)];
  }
  if (scopes.equipes != null) {
    if (!Array.isArray(scopes.equipes)) throw httpError(400, 'scopes_invalides', 'scopes.equipes doit être un tableau');
    const equipes = scopes.equipes.map(Number);
    if (equipes.some((e) => !Number.isInteger(e) || e <= 0)) {
      throw httpError(400, 'scopes_invalides', 'scopes.equipes doit contenir des ids d\'équipe');
    }
    if (equipes.length) out.equipes = [...new Set(equipes)];
  }
  return Object.keys(out).length ? out : null;
}

async function validerNom(nom, exceptId = null) {
  const n = String(nom ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/i.test(n)) {
    throw httpError(400, 'nom_invalide', 'Le nom (2 à 100 caractères : lettres, chiffres, . _ -) est obligatoire');
  }
  // Le nom joue le rôle du nom de jeton de config.json (req.tokenName) : pas de
  // doublon avec la configuration historique, qui y attacherait ses tokenScopes.
  if (Object.hasOwn(lireConfig().tokens || {}, n)) {
    throw httpError(409, 'nom_existant', `« ${n} » est déjà un jeton de config.json`);
  }
  const q = db('api_clients').where({ nom: n, trash: 0 });
  if (exceptId) q.whereNot('id', exceptId);
  if (await q.first('id')) throw httpError(409, 'nom_existant', `Un client « ${n} » existe déjà`);
  return n;
}

export async function creerClient(data, auteurId) {
  const nom = await validerNom(data.nom);
  const scopes = validerScopes(data.scopes);
  const [id] = await db('api_clients').insert({
    nom,
    description: data.description ?? '',
    actif: data.actif === undefined ? 1 : (data.actif ? 1 : 0),
    scopes: scopes ? JSON.stringify(scopes) : null,
    cree_par: auteurId ?? null,
  });
  invaliderCacheClients();
  return getClient(id);
}

export async function modifierClient(id, data) {
  await getClient(id);
  const patch = { modifie_le: db.fn.now() };
  if (data.nom !== undefined) patch.nom = await validerNom(data.nom, id);
  if (data.description !== undefined) patch.description = data.description ?? '';
  if (data.actif !== undefined) patch.actif = data.actif ? 1 : 0;
  if (data.scopes !== undefined) {
    const scopes = validerScopes(data.scopes);
    patch.scopes = scopes ? JSON.stringify(scopes) : null;
  }
  await db('api_clients').where('id', id).update(patch);
  invaliderCacheClients();
  return getClient(id);
}

/** Corbeille ; ses jetons sont révoqués dans la foulée. */
export async function supprimerClient(id) {
  await getClient(id);
  await db.transaction(async (trx) => {
    await trx('api_clients').where('id', id).update({ trash: 1, modifie_le: trx.fn.now() });
    await trx('api_clients_tokens').where('client_id', id).whereNull('revoque_le').update({ revoque_le: trx.fn.now() });
  });
  invaliderCacheClients();
  return { success: true };
}

/**
 * Crée un jeton. **Seule occasion de lire le jeton en clair.**
 * @returns {Promise<{token: string, jeton: Object}>}
 */
export async function creerToken(clientId, { libelle, expire_le } = {}, auteurId) {
  await getClient(clientId);
  let expire = null;
  if (expire_le) {
    // Une date civile (YYYY-MM-DD) : le jeton vaut jusqu'à la fin de ce jour.
    const jour = String(expire_le).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || isNaN(new Date(jour))) {
      throw httpError(400, 'date_invalide', 'expire_le attend une date YYYY-MM-DD');
    }
    expire = `${jour} 23:59:59`;
    if (new Date(expire.replace(' ', 'T')) <= new Date()) {
      throw httpError(400, 'date_invalide', 'expire_le doit être dans le futur');
    }
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const [id] = await db('api_clients_tokens').insert({
    client_id: clientId,
    libelle: String(libelle ?? '').trim().slice(0, 100),
    token_hash: sha256(token),
    prefixe: token.slice(0, 12),
    cree_par: auteurId ?? null,
    expire_le: expire,
  });
  const jeton = await db('api_clients_tokens').where('id', id).first(TOKEN_FIELDS);
  return { token, jeton: { ...jeton, etat: etatToken(jeton) } };
}

export async function revoquerToken(clientId, tokenId) {
  const n = await db('api_clients_tokens')
    .where({ id: tokenId, client_id: clientId })
    .whereNull('revoque_le')
    .update({ revoque_le: db.fn.now() });
  if (!n) throw httpError(404, 'jeton_inconnu', `Jeton ${tokenId} introuvable ou déjà révoqué`);
  invaliderCacheClients();
  return { success: true };
}

export async function ajouterDomaine(clientId, raw) {
  await getClient(clientId);
  const domaine = normaliserDomaine(raw);
  if (!domaine) {
    throw httpError(400, 'domaine_invalide', 'Domaine attendu sous la forme host, host:port ou *.domaine');
  }
  const existe = await db('api_clients_domaines').where({ client_id: clientId, domaine }).first('id');
  if (existe) throw httpError(409, 'domaine_existant', `${domaine} est déjà autorisé pour ce client`);
  const [id] = await db('api_clients_domaines').insert({ client_id: clientId, domaine });
  invaliderCacheClients();
  return db('api_clients_domaines').where('id', id).first('id', 'client_id', 'domaine', 'cree_le');
}

export async function supprimerDomaine(clientId, domaineId) {
  const n = await db('api_clients_domaines').where({ id: domaineId, client_id: clientId }).del();
  if (!n) throw httpError(404, 'domaine_inconnu', `Domaine ${domaineId} introuvable`);
  invaliderCacheClients();
  return { success: true };
}

/**
 * Configuration historique, en lecture seule : noms des jetons de config.json
 * (jamais leur valeur), leurs `tokenScopes`, et les entrées de ALLOWED_DOMAINS.
 */
export function configHistorique() {
  const config = lireConfig();
  const scopes = config.tokenScopes || {};
  return {
    tokens: Object.keys(config.tokens || {}).map((nom) => ({ nom, scopes: scopes[nom] ?? null })),
    domaines: domainesEnv(),
  };
}
