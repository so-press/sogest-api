import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../../db.js';
import { slugify } from '../core/utils.js';
import { setUserLink } from './users.js';

/**
 * Comptes Mattermost des utilisateurs sogest (https://mattermost.sopress.com).
 *
 * Ce module est le SEUL à parler à l'API Mattermost : le jeton d'administration
 * (`MATTERMOST_TOKEN`) ne sort pas de sogest-api. sogest et le SSO passent par
 * les routes `/users/{id}/mattermost…`.
 *
 * - Droit : colonne `users.mattermost` (coché sur la fiche, ne se retire pas).
 * - Email du compte : valeur liée `email_mattermost`, sinon `users.email`.
 * - Id du compte : valeur liée `id_mattermost`, sans libellé (absente des
 *   valeurs additionnelles de la fiche, donc jamais écrasée par un submit).
 *
 * Un utilisateur est « en attente » s'il a le droit mais pas encore d'id : son
 * compte sera créé à sa prochaine connexion par mot de passe, seul moment où
 * l'on dispose du mot de passe en clair ({@link creerCompteMattermost}).
 *
 * Un compte « synchronisé » (`users.mattermost_sync`) porte l'email principal
 * de sogest et reçoit chaque mot de passe saisi dans sogest. Les comptes créés
 * par sogest le sont d'office ; un compte qui existait déjà se le voit
 * proposer par le bot du plugin com.sopress.sogest-login, et un refus
 * (`users.mattermost_sync_refus`) n'est reproposé qu'une semaine plus tard.
 */

const TIMEOUT_MS = 5000;

// Règles de Mattermost pour un nom d'utilisateur : minuscules, chiffres, `.`,
// `-` et `_`, commençant par une lettre, 64 caractères au plus.
const USERNAME_MAX = 64;
const USERNAME_RESERVES = ['all', 'channel', 'here', 'matterbot', 'system'];

// Id de l'équipe MATTERMOST_TEAM, qui ne change pas : lu une fois.
let equipeId = null;

/**
 * Appel à l'API v4 de Mattermost. Rend le corps décodé, ou null sur un 404 ;
 * toute autre erreur lève une exception portant le message de Mattermost.
 *
 * @param {string} chemin  ex. `/users/email/x@y.fr`
 * @param {string} [method]
 * @param {Object} [corps]
 */
async function mattermost(chemin, method = 'GET', corps = undefined) {
    const url = process.env.MATTERMOST_URL;
    const token = process.env.MATTERMOST_TOKEN;
    if (!url || !token) throw new Error('MATTERMOST_URL / MATTERMOST_TOKEN non configurés');

    const res = await fetch(url.replace(/\/+$/, '') + '/api/v4' + chemin, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corps !== undefined ? JSON.stringify(corps) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) return null;

    const texte = await res.text();
    let donnees = null;
    try { donnees = texte ? JSON.parse(texte) : null; } catch { donnees = null; }

    if (!res.ok) {
        const erreur = new Error(`Mattermost ${method} ${chemin} : ${donnees?.message || res.status}`);
        erreur.status = res.status;
        throw erreur;
    }
    return donnees;
}

/**
 * Ce que sogest sait du compte Mattermost d'un utilisateur, sans appeler
 * Mattermost. Null si l'utilisateur n'existe pas (ou est supprimé / inactif).
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, acces:boolean, id:string|null, email:string, nom:string, prenom:string, nomFamille:string}|null>}
 */
async function lireCompte(userId) {
    if (!userId || isNaN(userId)) return null;

    const u = await db('users as u')
        .leftJoin('personnes as p', 'u.personne_id', 'p.id')
        .select('u.id', 'u.email', 'u.nom', 'u.mattermost', 'u.mattermost_sync', 'u.mattermost_sync_refus',
            'p.prenom', 'p.nom as nomFamille')
        .where('u.id', userId)
        .where('u.trash', '<>', 1)
        .andWhere('u.actif', 1)
        .first();
    if (!u) return null;

    const links = await db('links')
        .select('champ', 'valeur')
        .where({ table: 'users', cle: String(userId) })
        .whereIn('champ', ['email_mattermost', 'id_mattermost']);
    const link = Object.fromEntries(links.map((l) => [l.champ, String(l.valeur ?? '').trim()]));

    return {
        userId: Number(u.id),
        acces: Number(u.mattermost) === 1,
        synchro: Number(u.mattermost_sync) === 1,
        refus: u.mattermost_sync_refus ? new Date(u.mattermost_sync_refus) : null,
        id: link.id_mattermost || null,
        email: link.email_mattermost || u.email,
        emailPrincipal: u.email,
        nom: u.nom || '',
        prenom: u.prenom || '',
        nomFamille: u.nomFamille || '',
    };
}

/**
 * État Mattermost d'un utilisateur, sans appel à Mattermost : le SSO le lit à
 * chaque connexion pour savoir s'il doit exiger le mot de passe.
 *
 * @param {number} userId
 * @returns {Promise<{acces:boolean, id:string|null, enAttente:boolean, synchro:boolean}|null>}
 */
export async function getEtatMattermost(userId) {
    const compte = await lireCompte(userId);
    if (!compte) return null;
    return {
        acces: compte.acces,
        id: compte.id,
        enAttente: compte.acces && !compte.id,
        synchro: compte.synchro,
    };
}

/**
 * C — Id du compte Mattermost qui porte cet email, ou null.
 *
 * @param {string} email
 * @returns {Promise<string|null>}
 */
export async function trouverCompteMattermost(email) {
    if (!email) return null;
    const compte = await mattermost('/users/email/' + encodeURIComponent(email));
    return compte?.id ?? null;
}

/**
 * Recherche (C) le compte Mattermost d'un utilisateur sogest et mémorise son id
 * s'il est trouvé. Ne crée rien : sans compte, l'utilisateur reste en attente.
 *
 * @param {number} userId
 * @returns {Promise<{acces:boolean, id:string|null, enAttente:boolean}|null>}
 */
export async function rechercherCompteMattermost(userId) {
    const compte = await lireCompte(userId);
    if (!compte) return null;

    const id = await trouverCompteMattermost(compte.email);
    if (id && id !== compte.id) {
        await setUserLink(compte.userId, 'id_mattermost', id);
    }
    return getEtatMattermost(userId);
}

/**
 * Nom d'utilisateur Mattermost libre tiré d'un nom complet : son slug, puis
 * `slug-2`, `slug-3`… tant qu'il est pris. La base est coupée avant d'ajouter
 * le suffixe, pour rester dans la longueur admise.
 *
 * @param {string} nomComplet
 * @returns {Promise<string>}
 */
export async function usernameMattermostLibre(nomComplet) {
    let base = slugify(nomComplet || '');
    // Mattermost exige une lettre en tête.
    if (!/^[a-z]/.test(base)) base = ('u-' + base).replace(/-+$/, '');

    for (let n = 1; ; n++) {
        const suffixe = n === 1 ? '' : `-${n}`;
        const candidat = base.slice(0, USERNAME_MAX - suffixe.length).replace(/-+$/, '') + suffixe;
        if (USERNAME_RESERVES.includes(candidat)) continue;
        const pris = await mattermost('/users/username/' + encodeURIComponent(candidat));
        if (!pris) return candidat;
    }
}

/**
 * Id de l'équipe dans laquelle entrent les comptes créés (MATTERMOST_TEAM,
 * nom de l'équipe dans son URL).
 *
 * @returns {Promise<string>}
 */
async function idEquipe() {
    if (equipeId) return equipeId;
    const nom = process.env.MATTERMOST_TEAM;
    if (!nom) throw new Error('MATTERMOST_TEAM non configurée');
    const equipe = await mattermost('/teams/name/' + encodeURIComponent(nom));
    if (!equipe?.id) throw new Error(`Équipe Mattermost « ${nom} » introuvable`);
    equipeId = equipe.id;
    return equipeId;
}

/**
 * A — Crée le compte Mattermost d'un utilisateur sogest avec ce mot de passe,
 * l'ajoute à l'équipe MATTERMOST_TEAM et mémorise son id. Créé avec l'email
 * principal et le mot de passe de sogest, le compte est synchronisé d'office.
 * Si un compte porte déjà son email (Mattermost ou principal), on en mémorise
 * l'id sans rien modifier côté Mattermost : c'est au bot de proposer la synchro.
 *
 * Le mot de passe doit avoir été vérifié par l'appelant : c'est celui que la
 * personne vient de saisir pour se connecter.
 *
 * @param {number} userId
 * @param {string} password  mot de passe en clair
 * @returns {Promise<string|null>} id du compte Mattermost, null si l'utilisateur est inconnu
 */
export async function creerCompteMattermost(userId, password) {
    const compte = await lireCompte(userId);
    if (!compte) return null;

    const existant = await trouverCompteMattermost(compte.email)
        ?? (compte.email !== compte.emailPrincipal ? await trouverCompteMattermost(compte.emailPrincipal) : null);
    if (existant) {
        await setUserLink(compte.userId, 'id_mattermost', existant);
        return existant;
    }

    const cree = await mattermost('/users', 'POST', {
        email: compte.emailPrincipal,
        username: await usernameMattermostLibre(compte.nom),
        password,
        first_name: compte.prenom,
        last_name: compte.nomFamille,
    });
    await setUserLink(compte.userId, 'id_mattermost', cree.id);
    await marquerSynchronise(compte.userId);

    // Sans équipe, la personne arriverait sur une instance vide ; mais un échec
    // ici ne doit pas défaire un compte déjà créé.
    try {
        const team = await idEquipe();
        await mattermost(`/teams/${team}/members`, 'POST', { team_id: team, user_id: cree.id });
    } catch (e) {
        console.error(`Mattermost : ajout de l'utilisateur ${compte.userId} à l'équipe impossible —`, e.message);
    }

    return cree.id;
}

/**
 * B — Donne ce mot de passe au compte Mattermost d'un utilisateur sogest, si ce
 * compte est synchronisé. Sinon ne fait rien : un compte en attente sera créé
 * avec ce même mot de passe à la prochaine connexion, et un compte existant
 * garde le sien tant que la personne n'a pas accepté la synchro.
 *
 * @param {number} userId
 * @param {string} password  mot de passe en clair
 * @returns {Promise<{synchronise:boolean, id:string|null}|null>} null si l'utilisateur est inconnu
 */
export async function synchroMotDePasseMattermost(userId, password) {
    const compte = await lireCompte(userId);
    if (!compte) return null;
    if (!compte.acces || !compte.synchro || !compte.id) return { synchronise: false, id: compte.id };

    await mattermost(`/users/${compte.id}/password`, 'PUT', { new_password: password });
    return { synchronise: true, id: compte.id };
}

/* ------------------------------------------------------------------ */
/* Synchro des comptes existants (bot du plugin com.sopress.sogest-login) */
/* ------------------------------------------------------------------ */

// Délai avant de reproposer la synchro à qui l'a refusée.
const SYNCHRO_DELAI_REFUS_MS = 7 * 24 * 60 * 60 * 1000;

async function marquerSynchronise(userId) {
    await db('users').where('id', userId).update({ mattermost_sync: 1, mattermost_sync_refus: null });
}

/** Utilisateur sogest actif relié à ce compte Mattermost (valeur liée `id_mattermost`). */
async function userIdParCompteMattermost(idMattermost) {
    if (!idMattermost) return null;
    const lien = await db('links as l')
        .join('users as u', db.raw('u.id = CAST(l.cle AS UNSIGNED)'))
        .select('u.id')
        .where({ 'l.table': 'users', 'l.champ': 'id_mattermost', 'l.valeur': idMattermost })
        .where('u.trash', '<>', 1)
        .andWhere('u.actif', 1)
        .first();
    return lien ? Number(lien.id) : null;
}

/**
 * Le plugin doit-il proposer la synchro à ce compte Mattermost, qui vient de se
 * connecter ? Oui s'il est relié à un utilisateur sogest qui a le droit, qu'il
 * n'est pas encore synchronisé, et qu'il ne l'a pas refusée depuis moins d'une
 * semaine.
 *
 * @param {string} idMattermost
 * @returns {Promise<{relie:boolean, synchro:boolean, aProposer:boolean}>}
 */
export async function etatSynchroCompteMattermost(idMattermost) {
    const userId = await userIdParCompteMattermost(idMattermost);
    const compte = userId ? await lireCompte(userId) : null;
    if (!compte || !compte.acces) return { relie: false, synchro: false, aProposer: false };

    const refusRecent = compte.refus && (Date.now() - compte.refus.getTime()) < SYNCHRO_DELAI_REFUS_MS;
    return { relie: true, synchro: compte.synchro, aProposer: !compte.synchro && !refusRecent };
}

/**
 * Réponse d'un compte Mattermost à la proposition de synchro.
 *
 * Oui : le compte Mattermost prend l'email principal de sogest (la valeur liée
 * `email_mattermost` n'a plus lieu d'être et disparaît) et devient synchronisé.
 * Son mot de passe deviendra celui de sogest à la prochaine saisie dans sogest.
 * Non : le refus est daté, pour ne reproposer que dans une semaine.
 *
 * @param {string} idMattermost
 * @param {boolean} accepte
 * @returns {Promise<{relie:boolean, synchro:boolean}>}
 */
export async function repondreSynchroMattermost(idMattermost, accepte) {
    const userId = await userIdParCompteMattermost(idMattermost);
    const compte = userId ? await lireCompte(userId) : null;
    if (!compte || !compte.acces) return { relie: false, synchro: false };
    if (compte.synchro) return { relie: true, synchro: true };

    if (!accepte) {
        await db('users').where('id', compte.userId).update({ mattermost_sync_refus: db.fn.now() });
        return { relie: true, synchro: false };
    }

    const actuel = await mattermost('/users/' + encodeURIComponent(idMattermost));
    if (!actuel) throw new Error('Compte Mattermost introuvable');
    if (String(actuel.email).toLowerCase() !== String(compte.emailPrincipal).toLowerCase()) {
        // Échoue (400) si un autre compte Mattermost porte déjà cet email.
        await mattermost(`/users/${idMattermost}/patch`, 'PUT', { email: compte.emailPrincipal });
    }
    await db('links').where({ table: 'users', cle: String(compte.userId), champ: 'email_mattermost' }).del();
    await marquerSynchronise(compte.userId);
    return { relie: true, synchro: true };
}

// Durée de vie d'un lien de connexion : le temps d'une redirection.
const LIEN_DUREE_SECONDES = 60;
const LIEN_SECRET_LONGUEUR_MIN = 32;
const PLUGIN_CONNEXION = 'com.sopress.sogest-login';

/**
 * Lien qui connecte un utilisateur à Mattermost sans mot de passe, par le
 * plugin serveur com.sopress.sogest-login : un JWT HS256 signé avec
 * MATTERMOST_LIEN_SECRET (partagé avec le plugin), qui désigne le compte
 * Mattermost, valable une minute et à usage unique (jti, vérifié par le plugin).
 *
 * @param {number} userId
 * @returns {Promise<{url:string|null, enAttente:boolean, acces:boolean}|null>}
 *   url null si l'utilisateur n'a pas le droit ou pas encore de compte ;
 *   null si l'utilisateur est inconnu
 */
export async function lienConnexionMattermost(userId) {
    const compte = await lireCompte(userId);
    if (!compte) return null;
    if (!compte.acces || !compte.id) {
        return { url: null, acces: compte.acces, enAttente: compte.acces && !compte.id };
    }

    const secret = process.env.MATTERMOST_LIEN_SECRET || '';
    if (secret.length < LIEN_SECRET_LONGUEUR_MIN) {
        throw new Error('MATTERMOST_LIEN_SECRET absente ou trop courte');
    }

    const jeton = jwt.sign({}, secret, {
        algorithm: 'HS256',
        subject: compte.id,
        jwtid: crypto.randomUUID(),
        expiresIn: LIEN_DUREE_SECONDES,
    });
    const base = (process.env.MATTERMOST_URL || '').replace(/\/+$/, '');
    return {
        url: `${base}/plugins/${PLUGIN_CONNEXION}/connexion?jeton=${encodeURIComponent(jeton)}`,
        acces: true,
        enAttente: false,
    };
}
