/**
 * @namespace Utils
 */
import dayjs from 'dayjs';
import { createHash } from 'node:crypto';

/**
 * @api {function} toDate Formate une date au format YYYY-MM-DD
 * @apiName ToDate
 * @apiGroup Utils
 *
 * @apiParam {(Date|String)} date Date à formater
 *
 * @apiSuccess {String} date Date formatée
 */
export function toDate(date) {
  return dayjs(date).format('YYYY-MM-DD')
}

/**
 * @api {function} removeAccents Supprime les accents d'une chaîne de caractères
 * @apiName RemoveAccents
 * @apiGroup Utils
 *
 * @apiParam {String} str Chaîne à nettoyer
 *
 * @apiSuccess {String} cleaned Chaîne sans accents
 */
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * @api {function} slugify Transforme plusieurs chaînes en un slug
 * @apiName Slugify
 * @apiGroup Utils
 *
 * @apiParam {...String} args Chaînes à concaténer
 *
 * @apiSuccess {String} slug Slug généré
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
 * @api {function} kebabToCamel Convertit une chaîne kebab-case en camelCase
 * @apiName KebabToCamel
 * @apiGroup Utils
 * @apiParam {String} str La chaîne à convertir
 * @apiSuccess {String} camel La chaîne convertie en camelCase
 */
export function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}


/**
 * @api {function} camelToKebab Convertit une chaîne camelCase en kebab-case
 * @apiName CamelToKebab
 * @apiGroup Utils
 * @apiParam {String} str La chaîne à convertir
 * @apiSuccess {String} kebab La chaîne convertie en kebab-case
 */
export function camelToKebab(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}




/**
 * @api {function} md5 Calcule le hachage MD5 d'une chaîne
 * @apiName Md5
 * @apiGroup Utils
 * @apiParam {String} str Chaîne source
 * @apiSuccess {String} hash Hash MD5
 */
export function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

/**
 * @api {function} choseDate Retourne la première date valide parmi la liste fournie
 * @apiName ChoseDate
 * @apiGroup Utils
 * @apiParam {...(Date|String)} args Dates potentielles
 * @apiSuccess {(Date|null)} date Date valide ou null
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
