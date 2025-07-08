/**
 * @namespace Utils
 */
import dayjs from 'dayjs';
import { createHash } from 'node:crypto';

/**
 * Formate une date au format YYYY-MM-DD.
 *
 * @param {Date|string} date - Date à formater
 * @returns {string} Date formatée
 */
export function toDate(date) {
  return dayjs(date).format('YYYY-MM-DD')
}

/**
 * Supprime les accents d'une chaîne de caractères.
 *
 * @param {string} str - Chaîne à nettoyer
 * @returns {string} Chaîne sans accents
 */
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Transforme plusieurs chaînes en un slug.
 *
 * @param {...string} args - Chaînes à concaténer
 * @returns {string} Slug généré
 */
export function slugify(...args) {
  const full = args.join(' ');
  const withoutAccents = removeAccents(full);
  return withoutAccents
    .replace(/[^a-zA-Z0-9]+/g, '-') // remplacer tout sauf lettres/chiffres par "-"
    .replace(/-+/g, '-')            // remplacer plusieurs "-" par un seul
    .replace(/^-|-$/g, '')         // retirer "-" au début ou à la fin
    .toLowerCase()
}

/**
 * Convertit une chaîne kebab-case en camelCase
 * @param {string} str - La chaîne à convertir
 * @returns {string} La chaîne convertie en camelCase
 */
export function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}


/**
 * Convertit une chaîne camelCase en kebab-case
 * @param {string} str - La chaîne à convertir
 * @returns {string} La chaîne convertie en kebab-case
 */
export function camelToKebab(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}




/**
 * Calcule le hachage MD5 d'une chaîne.
 * @param {string} str - Chaîne source
 * @returns {string} Hash MD5
 */
export function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

/**
 * Retourne la première date valide parmi la liste fournie.
 * @param {...(Date|string)} args - Dates potentielles
 * @returns {Date|null} Date valide ou null
 */
export function choseDate(...args) {
    for (const arg of args) {
        const date = new Date(arg);
        if (date instanceof Date && !isNaN(date.getTime())) {
            return date;
        }
    }
    return null;
}
