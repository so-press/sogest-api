import dayjs from 'dayjs';
import { createHash } from 'node:crypto';

export function toDate(date) {
  return dayjs(date).format('YYYY-MM-DD')
}
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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




export function md5(str) {
  return createHash('md5').update(str).digest('hex');
}


export function choseDate(...args) {
    for (const arg of args) {
        const date = new Date(arg);
        if (date instanceof Date && !isNaN(date.getTime())) {
            return date;
        }
    }
    return null;
}