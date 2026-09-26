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
        .select('u.id', 'u.email', 'u.nom', 'u.mattermost', 'p.prenom', 'p.nom as nomFamille')
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
        id: link.id_mattermost || null,
        email: link.email_mattermost || u.email,
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
 * @returns {Promise<{acces:boolean, id:string|null, enAttente:boolean}|null>}
 */
export async function getEtatMattermost(userId) {
    const compte = await lireCompte(userId);
    if (!compte) return null;
    return { acces: compte.acces, id: compte.id, enAttente: compte.acces && !compte.id };
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
 * l'ajoute à l'équipe MATTERMOST_TEAM et mémorise son id. Si un compte porte
 * déjà son email, on en mémorise l'id sans rien modifier côté Mattermost.
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

    const existant = await trouverCompteMattermost(compte.email);
    if (existant) {
        await setUserLink(compte.userId, 'id_mattermost', existant);
        return existant;
    }

    const cree = await mattermost('/users', 'POST', {
        email: compte.email,
        username: await usernameMattermostLibre(compte.nom),
        password,
        first_name: compte.prenom,
        last_name: compte.nomFamille,
    });
    await setUserLink(compte.userId, 'id_mattermost', cree.id);

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
 * B — Donne ce mot de passe au compte Mattermost d'un utilisateur sogest qui a
 * le droit Mattermost. Sans ce droit, ou sans compte Mattermost, ne fait rien : l'utilisateur reste en attente, et son
 * compte sera créé avec ce même mot de passe à sa prochaine connexion.
 *
 * @param {number} userId
 * @param {string} password  mot de passe en clair
 * @returns {Promise<{synchronise:boolean, id:string|null}|null>} null si l'utilisateur est inconnu
 */
export async function synchroMotDePasseMattermost(userId, password) {
    const compte = await lireCompte(userId);
    if (!compte) return null;
    if (!compte.acces) return { synchronise: false, id: compte.id };

    const id = await trouverCompteMattermost(compte.email);
    if (!id) return { synchronise: false, id: null };
    if (id !== compte.id) await setUserLink(compte.userId, 'id_mattermost', id);

    await mattermost(`/users/${id}/password`, 'PUT', { new_password: password });
    return { synchronise: true, id };
}
