import { db } from '../db.js';

export async function getUsers({ level = null, id = null, clause = null } = {}) {
    const query = db('users as u')
        .leftJoin('personnes as p', 'u.personne_id', 'p.id')
        .select(
            'u.id',
            'u.personne_id',
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


function formatUser(user) {
    if (!user) return;
    if (user.emails_alternatifs)
        user.emails_alternatifs = user.emails_alternatifs.split("\n").map(email => email.trim())
    return user
}