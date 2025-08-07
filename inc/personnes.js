/**
 * @namespace Personnes
 */
import { db } from '../db.js';
import { saveToHistorique } from './historique.js';
import { removeAccents, slugify, toDate } from './utils.js';

/**
 * @api {function} getPersonnes Retourne la liste des personnes actives
 * @apiName GetPersonnesFunc
 * @apiGroup Personnes
 *
 * @apiSuccess {Object[]} personnes Liste des personnes formatées
 */
export async function getPersonnes() {

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}

/**
 * @api {function} getPersonne Récupère une personne selon des critères optionnels
 * @apiName GetPersonneFunc
 * @apiGroup Personnes
 *
 * @apiParam {Object} [options]
 * @apiParam {Number} [options.user_id] Identifiant lié à l'utilisateur
 * @apiParam {Number} [options.id] Identifiant de la personne
 *
 * @apiSuccess {Object|undefined} personne Personne ou undefined
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
 * @api {function} updatePersonne Met à jour une personne dans la base
 * @apiName UpdatePersonneFunc
 * @apiGroup Personnes
 *
 * @apiParam {Number} id Identifiant de la personne
 * @apiParam {Object} data Données à mettre à jour
 *
 * @apiSuccess {Number} updated Nombre de lignes modifiées
 */
export async function updatePersonne(id, data) {
  if (!data) return;

  await saveToHistorique('personnes', id);

  const allowedFields = [ /* ...comme avant... */ ];

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
