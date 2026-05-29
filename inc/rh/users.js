import crypto from 'node:crypto';
import { db } from '../../db.js';
import { getPersonne } from './personnes.js';
import { slugify } from '../core/utils.js';


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
            'u.ultra_admin',
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
    // Exclut les comptes en corbeille / inactifs (cohérent avec getUsers) :
    // sans ça, un user trashé pouvait se connecter et casser le scoping des routes.
    const user = await db('users')
        .where({ email })
        .where('trash', '<>', 1)
        .andWhere('actif', 1)
        .first();

    if (user) return user;

    // Second try: look for the email in 'emails_alternatifs' (newline-separated)
    return formatUser(await db('users')
        .whereRaw('FIND_IN_SET(?, REPLACE(REPLACE(emails_alternatifs, "\r", ""), "\n", ","))', [email])
        .where('trash', '<>', 1)
        .andWhere('actif', 1)
        .first());
}

/**
 * Ids des supports rattachés à un utilisateur (colonne `users.supports`, CSV).
 * @param {number} userId
 * @returns {Promise<number[]>}
 */
export async function getUserSupportIds(userId) {
    if (!userId || isNaN(userId)) return [];
    const row = await db('users').select('supports').where('id', userId).where('trash', '<>', 1).first();
    if (!row || !row.supports) return [];
    return String(row.supports)
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
}


// Ids autorisés à voir les activités SoPress (cf. User::peutVoirActivitesSopress).
const SOPRESS_ACTIVITES_USER_IDS = [3867, 1838, 8, 9, 3662, 26, 1, 53];

const truthy = (v) => v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0;

/**
 * Capacités d'un utilisateur, portées de sogest (class.user.inc.php). Destiné à
 * être embarqué dans le JWT (`payload.can`) pour le gating UI côté front — la
 * vérification d'autorisation reste faite côté serveur sur chaque route.
 *
 * Primitives : `ultraAdmin` = level 'admin' + colonne `ultra_admin` ;
 * `link(x)` = droit présent dans la table `links` ; `appli(x)` = app dans la
 * liste `applis` (surcharge possible par un link 'applis').
 *
 * Méthodes non portées : celles liées à la session (`isRealUser`,
 * `adminIsConnectedAs`, `peutSeConnecterEnTantQue` côté connect-as), par
 * ressource (`hasAccessToPdf`), `okCb` (donnée cb retirée du produit) et
 * `isLoggedPermanent` (nécessite la lecture des contrats).
 *
 * @param {number} userId
 * @returns {Promise<Object>} objet `can`
 */
export async function getUserCapabilities(userId) {
    const can = {
        ultraAdmin: false, admin: false, vip: false, redacteur: false, personne: false,
        kiosque: false, voirActivitesSopress: false, permanent: false, accesPdf: false,
        traiterNdf: false, saisirNdfPourTiers: false, saisirAvances: false,
        saisirAvancePourTiers: false, traiterProd: false, traiterDocuments: false,
        adminOffice: false, seConnecterEnTantQue: false,
    };
    if (!userId || isNaN(userId)) return can;

    const u = await db('users').select('*').where('id', userId).where('trash', '<>', 1).first();
    if (!u) return can;

    const links = await db('links')
        .select('champ', 'valeur')
        .where({ table: 'users', cle: String(userId) });
    const linkMap = Object.fromEntries(links.map((l) => [l.champ, l.valeur]));
    const link = (champ) => truthy(linkMap[champ]);

    // applis : surcharge link('applis') sinon colonne users.applis.
    const appliRaw = truthy(linkMap.applis) ? linkMap.applis : (u.applis ?? '');
    const applis = String(appliRaw) === '0'
        ? []
        : String(appliRaw).split(',').map((s) => s.trim()).filter(Boolean);
    const appli = (name) => applis.includes(name);

    const ultraAdmin = u.level === 'admin' && truthy(u.ultra_admin);
    const admin = ultraAdmin || u.level === 'admin';
    const voirActivitesSopress = SOPRESS_ACTIVITES_USER_IDS.includes(Number(u.id));
    const traiterNdf = ultraAdmin || (appli('ndf') && link('ndf_trt'));

    can.ultraAdmin = ultraAdmin;
    can.admin = admin;
    can.vip = u.level === 'vip' || admin;
    can.redacteur = admin || u.level === 'user';
    can.personne = u.level === 'personne';
    can.kiosque = admin || truthy(u.kiosque);
    can.voirActivitesSopress = voirActivitesSopress;
    can.traiterNdf = traiterNdf;
    can.saisirNdfPourTiers = ultraAdmin || traiterNdf || link('ndf_tiers');
    can.saisirAvances = ultraAdmin || traiterNdf || link('demander_avances');
    can.saisirAvancePourTiers = ultraAdmin;
    can.traiterProd = ultraAdmin || admin || (appli('salaires') && link('peut_saisir_contrats'));
    can.traiterDocuments = (ultraAdmin && voirActivitesSopress) || link('doc_trt');
    can.adminOffice = ultraAdmin || link('admin_office');
    can.seConnecterEnTantQue = ultraAdmin || link('connect_as');

    // isLoggedPermanent : admin OU contrat de la personne ∈ CONTRATS_PERMANENTS.
    let permanent = admin;
    if (!permanent && u.personne_id) {
        const personne = await db('personnes').select('*').where('id', u.personne_id).where('trash', '<>', 1).first();
        const contrat = String(personne?.contrat ?? '').trim().toLowerCase();
        if (contrat) {
            let permTypes = [];
            try {
                const opt = await db('options')
                    .select('valeur')
                    .where('cle', 'CONTRATS_PERMANENTS')
                    .first();
                permTypes = String(opt?.valeur ?? '')
                    .split(/\r?\n/)
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean);
            } catch {
                /* option absente */
            }
            permanent = permTypes.includes(contrat);
        }
    }
    can.permanent = permanent;

    // hasAccessToPdf, part niveau utilisateur : permanent OU kiosque OU équipe
    // « peut visualiser les pdfs » (4029). L'exception par activité (pige sur
    // l'activité demandée) reste vérifiée côté serveur, non exprimable ici.
    const PDF_TEAM_ID = 4029;
    let accesPdf = permanent || can.kiosque;
    if (!accesPdf) {
        const lien = await db('lien_equipe_user')
            .where({ user_id: userId, equipe_id: PDF_TEAM_ID })
            .first();
        accesPdf = !!lien;
    }
    can.accesPdf = accesPdf;

    return can;
}

// Colonnes de la table `users`, en cache. Sert à interdire qu'un link porte le
// nom d'une vraie colonne (sinon il écraserait ce champ une fois fusionné).
let usersColumnsCache = null;
async function getUsersColumns() {
    if (!usersColumnsCache) {
        const info = await db('users').columnInfo();
        usersColumnsCache = new Set(Object.keys(info).map((c) => c.toLowerCase()));
    }
    return usersColumnsCache;
}

/**
 * Vrai si `champ` correspond à une colonne de la table `users` (donc interdit
 * comme nom de link, car il écraserait la vraie valeur dans l'objet user).
 * @param {string} champ
 * @returns {Promise<boolean>}
 */
export async function isReservedUserField(champ) {
    const columns = await getUsersColumns();
    return columns.has(String(champ).toLowerCase());
}

/**
 * Crée ou met à jour une valeur liée (« link » / meta) d'un utilisateur.
 *
 * Upsert sur la clé unique `(champ, cle, table)` de la table `links`
 * (`table` = 'users', `cle` = id utilisateur). Ces valeurs sont ensuite
 * fusionnées à plat dans l'objet user par {@link getUsers} (sauf les champs
 * préfixés `_`, internes, qui ne sont pas exposés).
 *
 * Le `champ` ne peut pas porter le nom d'une colonne de la table `users`.
 *
 * @param {number} userId
 * @param {string} champ
 * @param {string} valeur
 * @param {string} [libelle] Libellé d'affichage (défaut : `champ`)
 * @returns {Promise<{table:string, cle:string, champ:string, valeur:string, libelle:string}>}
 */
export async function setUserLink(userId, champ, valeur, libelle = null) {
    if (!userId || isNaN(userId)) throw new Error('Invalid user ID');
    if (!champ || typeof champ !== 'string') throw new Error('champ is required');
    if (await isReservedUserField(champ)) {
        throw new Error(`champ "${champ}" est réservé (colonne de la table users)`);
    }

    const table = 'users';
    const cle = String(userId);
    const val = valeur == null ? '' : String(valeur);
    const hasLibelle = libelle != null; // undefined/null => non fourni

    if (hasLibelle) {
        // libelle fourni : posé à la création, écrasé à l'update.
        await db.raw(
            'INSERT INTO `links` (`table`, `cle`, `champ`, `valeur`, `libelle`) VALUES (?, ?, ?, ?, ?) '
            + 'ON DUPLICATE KEY UPDATE `valeur` = VALUES(`valeur`), `libelle` = VALUES(`libelle`)',
            [table, cle, champ, val, String(libelle)]
        );
    } else {
        // libelle non fourni : '' par défaut à la création, laissé inchangé à l'update.
        await db.raw(
            'INSERT INTO `links` (`table`, `cle`, `champ`, `valeur`, `libelle`) VALUES (?, ?, ?, ?, ?) '
            + 'ON DUPLICATE KEY UPDATE `valeur` = VALUES(`valeur`)',
            [table, cle, champ, val, '']
        );
    }

    return await db('links')
        .select('champ', 'valeur', 'libelle')
        .where({ table, cle, champ })
        .first();
}

/**
 * Récupère les valeurs liées (« links » / metas) d'un utilisateur.
 * Par défaut, exclut les champs internes préfixés `_`.
 *
 * @param {number} userId
 * @param {{includeInternal?: boolean}} [options]
 * @returns {Promise<Array<{champ:string, valeur:string, libelle:string}>>}
 */
export async function getUserLinks(userId, { includeInternal = false } = {}) {
    if (!userId || isNaN(userId)) throw new Error('Invalid user ID');

    const rows = await db('links')
        .select('champ', 'valeur', 'libelle')
        .where({ table: 'users', cle: String(userId) })
        .orderBy('champ', 'asc');

    return includeInternal ? rows : rows.filter((r) => !String(r.champ).startsWith('_'));
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

    // Fusionne les valeurs liées (table `links`) directement comme propriétés de
    // l'utilisateur.
    // - Les champs préfixés `_` sont internes : on ne les expose pas.
    // - Garde-fou : on n'écrase jamais une clé déjà présente sur l'objet user
    //   (colonne/alias). setUserLink l'empêche déjà à l'écriture, mais la base
    //   peut être modifiée par ailleurs (app legacy, SQL direct) : on se protège
    //   ici aussi contre l'écrasement de `level`, `email`, etc.
    if (user.links) {
        for (const pair of user.links.split('\x1e')) {
            const [champ, valeur] = pair.split('\x1f');
            if (champ.startsWith('_')) continue;
            if (Object.prototype.hasOwnProperty.call(user, champ)) continue;
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
