import crypto from 'node:crypto';
import { db } from '../db.js';
import { getPersonne } from '../inc/personnes.js';
import { slugify } from './utils.js';


/**
 * Retourne l'URL de l'avatar à utiliser pour un utilisateur donné.
 *
 * La priorité est la suivante :
 * 1. personne.photo si défini et non vide
 * 2. user.avatar si défini et non vide
 * 3. gravatar généré à partir de l'email
 * 4. URL par défaut définie dans process.env.DEFAULT_AVATAR
 *
 * @param {Object} user - L'objet utilisateur (doit contenir `email`, `avatar`)
 * @param {'small'|'medium'|'big'} [size='medium'] - Taille demandée
 *   (appliquée uniquement à l'URL Gravatar via `s=`)
 * @returns {String} URL de l'avatar
 */
export const AVATAR_SIZES = { small: 64, medium: 128, big: 256 };

export async function getUserAvatar(user, size = 'medium') {
    if (user?.avatar) {
        return user.avatar;
    }

    const px = AVATAR_SIZES[size] || AVATAR_SIZES.medium;

    
    const personne = user?.personne_id
        ? await getPersonne({personne_id : user.personne_id})
        : null;

    if (personne?.photo && personne.photo !== 'false') {
        return personne.photo;
    }

    if (user?.email) {
        const hash = crypto.createHash('md5').update(user.email.trim().toLowerCase()).digest('hex');
        return `https://www.gravatar.com/avatar/${hash}?s=${px}&d=404`;
    }

    return process.env.DEFAULT_AVATAR || '';
}

/**
 * Récupère un utilisateur par son id.
 * @param {number} id
 * @returns {Promise<Object|false|undefined>} Utilisateur, false si introuvable
 */
export async function getUser(id) {
    const rsp =  await getUsers({ id });

    if(rsp) {
        return rsp[0] || false;
    }
}
/**
 * Liste les utilisateurs actifs selon différents critères (level, id, clause SQL).
 * @param {{level?: number, id?: number, clause?: {raw: string, params: any[]}}} [options]
 * @returns {Promise<Object[]>}
 */
export async function getUsers({ level = null, id = null, clause = null } = {}) {
    // Sous-requête agrégeant les valeurs liées (table `links`) par utilisateur.
    // GROUP_CONCAT car JSON_OBJECTAGG n'est pas disponible (MariaDB).
    // Séparateurs : 0x1f (champ/valeur) et 0x1e (entre paires), improbables dans les données.
    const linksSub = db('links')
        .select('cle')
        .select(db.raw("GROUP_CONCAT(CONCAT(champ, 0x1f, valeur) SEPARATOR 0x1e) as links"))
        .where('table', 'users')
        .groupBy('cle')
        .as('l');

    const query = db('users as u')
        .leftJoin('personnes as p', 'u.personne_id', 'p.id')
        .leftJoin(linksSub, 'u.id', 'l.cle')
        .select(
            'u.id',
            'u.personne_id',
            'u.nom as nomComplet',
            'p.nom',
            'p.prenom',
            'u.email',
            'u.level',
            'u.avatar',
            'u.emails_alternatifs', // include this so formatUser can use it
            'l.links' // valeurs liées agrégées (JSON)
        )
        .where('u.trash', '<>', 1)
        .andWhere('u.actif', 1)
        .orderBy([{ column: 'p.nom', order: 'desc' }, { column: 'p.prenom', order: 'desc' }]);

    if (id) {
        query.andWhere('u.id', id);
    }

    if (level) {
        query.andWhere('u.level', level);
    }

    if (clause) {
        query.andWhereRaw(clause.raw, clause.params);
    }

    const users = await query;

    return users.map(formatUser);
}

/**
 * Recherche un utilisateur par email principal, puis par `emails_alternatifs`.
 * @param {string} email
 * @returns {Promise<Object|undefined>}
 */
export async function getUserByEmail(email) {
    // First try: match against primary email field
    const user = await db('users')
        .where({ email })
        .first();

    if (user) return user;

    // Second try: look for the email in 'emails_alternatifs' (newline-separated)
    return formatUser(await db('users')
        .whereRaw('FIND_IN_SET(?, REPLACE(REPLACE(emails_alternatifs, "\r", ""), "\n", ","))', [email])
        .first());
}


/**
 * Formate les données d'un utilisateur récupérées en base.
 *
 * @param {Object} user - Données brutes
 * @returns {Object|undefined} Données formatées
 */
function formatUser(user) {
    if (!user) return;
    if (user.emails_alternatifs)
        user.emails_alternatifs = user.emails_alternatifs.split("\n").map(email => email.trim())

    // Fusionne les valeurs liées (table `links`) directement comme propriétés de l'utilisateur
    if (user.links) {
        for (const pair of user.links.split('\x1e')) {
            const [champ, valeur] = pair.split('\x1f');
            user[champ] = valeur;
        }
    }
    delete user.links;

    // slug_visio : si vide, fallback sur un slug du nom complet
    if (!user.slug_visio) {
        user.slug_visio = slugify(user.nomComplet || '');
    }

    return user
}
