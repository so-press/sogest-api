import dayjs from 'dayjs';
import { createHash } from 'node:crypto';

/**
 * Formate une date au format YYYY-MM-DD.
 * @param {Date|string} date
 * @returns {string}
 */
export function toDate(date) {
  return dayjs(date).format('YYYY-MM-DD')
}

/**
 * Supprime les accents d'une chaîne (NFD + suppression des marques diacritiques).
 * @param {string} str
 * @returns {string}
 */
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Transforme plusieurs chaînes en un slug kebab-case sans accents.
 * @param {...string} args
 * @returns {string}
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
 * Convertit une chaîne kebab-case en camelCase.
 * @param {string} str
 * @returns {string}
 */
export function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}


/**
 * Convertit une chaîne camelCase en kebab-case.
 * @param {string} str
 * @returns {string}
 */
export function camelToKebab(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}




/**
 * Calcule le hachage MD5 d'une chaîne.
 * @param {string} str
 * @returns {string}
 */
export function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

/**
 * Retourne la première date valide parmi la liste fournie, ou null.
 * @param {...(Date|string)} args
 * @returns {Date|null}
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
