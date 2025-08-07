/**
 * @namespace Users
 */
import { db } from '../db.js';
import { getPersonne } from '../inc/personnes.js';


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
 * @param {Object} personne - L'objet personne (doit contenir `photo`)
 * @returns {String} URL de l'avatar
 */
export async function getUserAvatar(user) {

    const personne = await getPersonne({personne_id : user.personne_id});

    if (personne?.photo && personne.photo !== 'false') {
        return personne.photo;
    }
    if (user?.avatar) {
        return user.avatar;
    }

    if (user?.email) {
        const hash = crypto.createHash('md5').update(user.email.trim().toLowerCase()).digest('hex');
        return `https://www.gravatar.com/avatar/${hash}?d=404`;
    }

    return process.env.DEFAULT_AVATAR || '';
}

/**
 * @api {function} getUser Récupère un utilisateur par son identifiant
 * @apiName GetUserFunc
 * @apiGroup Users
 *
 * @apiParam {Number} id Identifiant de l'utilisateur
 *
 * @apiSuccess {Object|false} user Utilisateur ou false si introuvable
 */
export async function getUser(id) {
    const rsp =  await getUsers({ id });

    if(rsp) {
        return rsp[0] || false;
    }
}
/**
 * @api {function} getUsers Récupère une liste d'utilisateurs selon différents critères
 * @apiName GetUsersFunc
 * @apiGroup Users
 *
 * @apiParam {Object} [options]
 * @apiParam {Number} [options.level] Filtrer par niveau
 * @apiParam {Number} [options.id] Filtrer par identifiant
 * @apiParam {Object} [options.clause] Clause personnalisée
 *
 * @apiSuccess {Object[]} users Utilisateurs formatés
 */
export async function getUsers({ level = null, id = null, clause = null } = {}) {
    const query = db('users as u')
        .leftJoin('personnes as p', 'u.personne_id', 'p.id')
        .select(
            'u.id',
            'u.personne_id',
            'u.nom as nomComplet',
            'p.nom',
            'p.prenom',
            'u.email',
            'u.level',
            'u.emails_alternatifs' // include this so formatUser can use it
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
 * @api {function} getUserByEmail Recherche un utilisateur par son adresse e-mail
 * @apiName GetUserByEmail
 * @apiGroup Users
 *
 * @apiParam {String} email Adresse e-mail à rechercher
 *
 * @apiSuccess {Object|undefined} user Utilisateur trouvé ou undefined
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
    return user
}
