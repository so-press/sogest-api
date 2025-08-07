/**
 * @namespace Options
 */
import { db } from '../db.js';
import { parse } from 'csv-parse/sync'


/**
 * Récupère une option depuis la base de données et applique un filtre éventuel (CSV).
 * Lève une erreur si l'option n'existe pas.
 *
 * @param {string} cle - Clé de l'option à récupérer.
 * @param {object} args - Arguments optionnels (ex: { filter: 'csv' }).
 * @returns {Promise<any>} Valeur de l'option, potentiellement filtrée.
 * @throws {Error} Si aucune option n'est trouvée pour la clé donnée.
 */
export async function getOption(cle, args = {}) {
  const { filter } = args

  const [option] = await db('options')
    .where('cle', '=', cle)
    .limit(1)

  if (!option) {
    throw new Error(`Option "${cle}" introuvable.`)
  }

  let valeur = option.valeur

  if (filter === 'csv') {
    try {
      const records = parse(valeur, {
        columns: false,
        skip_empty_lines: true,
        trim: true,
      })

      valeur = records.flat()
    } catch (err) {
      console.error('CSV parse error:', err)
      valeur = []
    }
  }

  return valeur
}
