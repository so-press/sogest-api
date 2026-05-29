import { db } from '../../db.js';
import { saveToHistorique } from '../systeme/historique.js';
import { getOption } from '../core/options.js';
import { removeAccents, slugify, toDate } from '../core/utils.js';


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
 * Met à jour une personne (champs whitelistés, sauvegarde l'état dans l'historique).
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<number>} nombre de lignes modifiées
 */
export async function updatePersonne(id, data) {
  if (!data) return;

  await saveToHistorique('personnes', id);

  const allowedFields = [ /* ...comme avant... */];

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
