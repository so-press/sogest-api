/**
 * @namespace Personnes
 */
import { db } from '../db.js';
import { removeAccents, slugify, toDate } from './utils.js';

/**
 * Retourne la liste des personnes actives.
 *
 * @returns {Promise<Object[]>} Liste des personnes formatées
 */
export async function getPersonnes() {

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}

/**
 * Récupère une personne selon des critères optionnels.
 *
 * @param {Object} [options]
 * @param {number} [options.user_id] - Identifiant lié à l'utilisateur
 * @param {number} [options.id] - Identifiant de la personne
 * @returns {Promise<Object|undefined>} Personne ou undefined
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

  return formaterPersonne(await query.first()); // returns only one row
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
 * Met à jour une personne dans la base.
 *
 * @param {number} id - Identifiant de la personne
 * @param {Object} data - Données à mettre à jour
 * @returns {Promise<number>} Nombre de lignes modifiées
 */
export async function updatePersonne(id, data) {
  if (!data) return;
  const allowedFields = [
    'statut',
    'equipe',
    'fonction',
    'nom',
    'prenom',
    'email',
    'telephone',
    'date_naissance',
    'lieu_naissance',
    'pays_naissance',
    'nationalite',
    'adresse',
    'code_postal',
    'ville',
    'pays',
    'transport',
    'securite_sociale',
    'mutuelle',
    'deduction_forfaitaire',
    'iban',
    'bic',
    'carte_presse_numero',
    'carte_presse_date'
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  // Traitement spécial pour les champs *_raw
  if (data.prenom !== undefined) {
    updateData.prenom_raw = removeAccents(data.prenom);
  }
  if (data.nom !== undefined) {
    updateData.nom_raw = removeAccents(data.nom);
  }

  // Slug si nom ou prénom changent
  if (data.prenom !== undefined || data.nom !== undefined) {
    const prenom = data.prenom !== undefined ? data.prenom : (await db('personnes').where({ id }).first()).prenom;
    const nom = data.nom !== undefined ? data.nom : (await db('personnes').where({ id }).first()).nom;
    updateData.slug = slugify(nom, prenom);
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('Aucun champ à mettre à jour');
  }

  return await db('personnes')
    .where({ id })
    .update(updateData);
}

