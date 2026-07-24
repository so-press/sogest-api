import { db } from '../../db.js';
import { saveToHistorique } from '../systeme/historique.js';
import { getOption } from '../core/options.js';
import { removeAccents, slugify, toDate } from '../core/utils.js';
import { sogestUrl } from '../core/sogest.js';


export async function getPermanents() {
  const contrats = await getOption('CONTRATS_PERMANENTS', { filter: 'csv' });
  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .where('contrat', 'in', contrats)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}
/**
 * Liste des personnes non corbeille, triées nom/prénom.
 * @returns {Promise<Object[]>}
 */
export async function getPersonnes() {

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}

/**
 * Teste si une URL répond (fichier présent sur le serveur de fichiers SOGEST).
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function urlExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * URL de la pièce d'identité d'une personne, si un fichier existe. Le fichier
 * n'est pas en base (uploadé depuis l'admin PHP dans uploads/files/personnes/{id}/),
 * on teste donc les extensions autorisées par ce formulaire (doc, pdf, docx).
 * @param {number} id
 * @returns {Promise<string|null>}
 */
async function resolvePieceIdentiteUrl(id) {
  const base = `uploads/files/personnes/${id}/`;
  for (const ext of ['pdf', 'doc', 'docx']) {
    const url = sogestUrl(`${base}piece-identite.${ext}`);
    if (await urlExists(url)) return url;
  }
  return null;
}

/**
 * Récupère une personne par id (ou user_id).
 * @param {{id?: number, personne_id?: number, user_id?: number}} [options]
 * @returns {Promise<Object|undefined>}
 */
export async function getPersonne(options = {}) {
  const user_id = options.user_id || null;
  const id = options.id || options.personne_id || null;

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1);

  if (user_id) {
    query.andWhere('user_id', user_id);
  }

  if (id) {
    query.andWhere('id', id);
  }

  const row = await query.first();
  if (!row) return undefined;

  const personne = formaterPersonne(row);
  personne.piece_identite_url = await resolvePieceIdentiteUrl(personne.id);
  return personne;
}

/**
 * Récupère les congés stockés dans `meta.conges` d'une personne.
 * @param {number} personneId
 * @returns {Promise<Object|null>} l'objet congés, ou null s'il n'existe pas
 */
export async function getConges(personneId) {
  const personne = await getPersonne({ id: personneId });
  if (!personne) return null;

  let meta = personne.meta;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return null;
    }
  }

  return meta?.conges ?? null;
}

/**
 * Formate une entrée personne issue de la base.
 *
 * @param {Object} personne - Données brutes de la personne
 * @returns {Object} Données formatées
 */
function formaterPersonne(personne) {
  personne.date_naissance = toDate(personne.date_naissance)
  return personne;
}
/**
 * Met à jour une personne (champs whitelistés, sauvegarde l'état dans l'historique).
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<number>} nombre de lignes modifiées
 */
export async function updatePersonne(id, data) {
  if (!data) return;

  await saveToHistorique('personnes', id);

  const allowedFields = [
    'nom',
    'prenom',
    'email',
    'email_perso',
    'telephone',
    'date_naissance',
    'lieu_naissance',
    'pays_naissance',
    'nationalite',
    'adresse',
    'code_postal',
    'ville',
    'pays',
    'equipe',
    'equipe_id',
    'fonction',
    'contrat',
    'transport',
    'securite_sociale',
    'mutuelle',
    'deduction_forfaitaire',
    'iban',
    'bic',
    'numero_carte_presse',
    'date_carte_presse',
    'nom_usage',
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  if (data.prenom !== undefined) {
    updateData.prenom_raw = removeAccents(data.prenom);
  }
  if (data.nom !== undefined) {
    updateData.nom_raw = removeAccents(data.nom);
  }

  if (data.prenom !== undefined || data.nom !== undefined) {
    const prenom = data.prenom !== undefined ? data.prenom : (await db('personnes').where({ id }).where('trash', '<>', 1).first()).prenom;
    const nom = data.nom !== undefined ? data.nom : (await db('personnes').where({ id }).where('trash', '<>', 1).first()).nom;
    updateData.slug = slugify(nom, prenom);
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('Aucun champ à mettre à jour');
  }

  return await db('personnes')
    .where({ id })
    .update(updateData);
}
