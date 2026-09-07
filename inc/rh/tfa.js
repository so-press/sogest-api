import crypto from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { db } from '../../db.js';
import { getOption } from '../core/options.js';
import { envoyerSms } from '../core/sms.js';

/**
 * Authentification forte (2FA) des comptes sogest.
 *
 * Ce module est la SEULE source de vérité : la règle « ce compte doit-il une
 * 2FA » est calculée ici, et le matériel secret (secret TOTP, code SMS, codes
 * de secours, jetons d'appareil) ne sort jamais de sogest-api. Le SSO présente
 * les écrans et appelle les endpoints — il ne voit ni secret ni code.
 *
 * Règle appliquée par {@link getTfaPolicy} :
 *
 *   2FA exigée si  ultra admin                        (jamais désactivable)
 *              ou  réglage user `tfa` = 'oui'
 *              ou  (réglage absent et option FORCER_TFA)
 *   2FA levée  si  réglage user `tfa` = 'non'         (et pas ultra admin)
 */

// Durée de vie d'un code SMS, et délai minimum entre deux envois.
const SMS_TTL = 300;
const SMS_DELAI_RENVOI = 60;

// Un code TOTP dure 30 s ; on accepte le pas précédent et le suivant pour
// absorber la dérive d'horloge du téléphone.
const TOTP_PAS = 30;
const TOTP_FENETRE = 1;
const TOTP_CHIFFRES = 6;

// Verrou temporaire après une série d'échecs, pour rendre le code à 6 chiffres
// non énumérable (c'est ce qui manquait au dispositif précédent).
const MAX_ECHECS = 5;
const BLOCAGE_SECONDES = 900;

const APPAREIL_JOURS = 30;
const NB_CODES_SECOURS = 8;

// Alphabet des codes de secours : ni 0/O ni 1/I/L, pour une dictée au téléphone.
const ALPHABET_SECOURS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/* ------------------------------------------------------------------ */
/* Chiffrement du secret TOTP au repos                                 */
/* ------------------------------------------------------------------ */

/**
 * Clé de chiffrement des secrets TOTP (32 octets, hex ou base64 dans
 * `TFA_ENCRYPTION_KEY`). Absente, on refuse de démarrer un enrôlement plutôt
 * que d'écrire des secrets en clair.
 */
function cleChiffrement() {
    const brut = process.env.TFA_ENCRYPTION_KEY || '';
    if (!brut) throw new Error('TFA_ENCRYPTION_KEY non configurée');

    const cle = /^[0-9a-f]{64}$/i.test(brut)
        ? Buffer.from(brut, 'hex')
        : Buffer.from(brut, 'base64');

    if (cle.length !== 32) throw new Error('TFA_ENCRYPTION_KEY doit faire 32 octets');
    return cle;
}

/** Chiffre un secret en AES-256-GCM. Sortie : iv(12) | tag(16) | chiffré. */
function chiffrer(texte) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', cleChiffrement(), iv);
    const chiffre = Buffer.concat([cipher.update(texte, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), chiffre]);
}

/** Déchiffre une valeur produite par {@link chiffrer}. */
function dechiffrer(buffer) {
    const buf = Buffer.from(buffer);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cleChiffrement(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238)                                                      */
/* ------------------------------------------------------------------ */

/** Encode des octets en base32 sans padding (alphabet RFC 4648). */
function base32Encode(buffer) {
    let bits = 0;
    let valeur = 0;
    let sortie = '';

    for (const octet of buffer) {
        valeur = (valeur << 8) | octet;
        bits += 8;
        while (bits >= 5) {
            sortie += BASE32[(valeur >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) sortie += BASE32[(valeur << (5 - bits)) & 31];

    return sortie;
}

/** Décode une chaîne base32 (padding et espaces tolérés). */
function base32Decode(chaine) {
    const propre = String(chaine).toUpperCase().replace(/[^A-Z2-7]/g, '');
    const octets = [];
    let bits = 0;
    let valeur = 0;

    for (const caractere of propre) {
        valeur = (valeur << 5) | BASE32.indexOf(caractere);
        bits += 5;
        if (bits >= 8) {
            octets.push((valeur >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(octets);
}

/** Code TOTP à 6 chiffres pour un pas donné (HMAC-SHA1, RFC 4226 §5.3). */
function totpCode(secretBase32, pas) {
    const compteur = Buffer.alloc(8);
    compteur.writeBigUInt64BE(BigInt(pas));

    const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(compteur).digest();
    const decalage = hmac[hmac.length - 1] & 0x0f;
    const tronque = hmac.readUInt32BE(decalage) & 0x7fffffff;

    return String(tronque % 10 ** TOTP_CHIFFRES).padStart(TOTP_CHIFFRES, '0');
}

/**
 * Cherche le code saisi dans la fenêtre de tolérance et renvoie le pas qui
 * correspond, ou null. Le pas est renvoyé pour que l'appelant l'enregistre et
 * refuse ensuite tout rejeu du même code.
 */
function totpVerifier(secretBase32, code, pasMinimum = null) {
    const saisi = String(code).replace(/\D/g, '');
    if (saisi.length !== TOTP_CHIFFRES) return null;

    const maintenant = Math.floor(Date.now() / 1000 / TOTP_PAS);

    for (let ecart = -TOTP_FENETRE; ecart <= TOTP_FENETRE; ecart++) {
        const pas = maintenant + ecart;
        if (pasMinimum !== null && pas <= pasMinimum) continue;
        if (comparaisonConstante(totpCode(secretBase32, pas), saisi)) return pas;
    }

    return null;
}

/** Comparaison à temps constant de deux chaînes de même nature. */
function comparaisonConstante(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function sha256(valeur) {
    return crypto.createHash('sha256').update(String(valeur)).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Numéros de téléphone                                                 */
/* ------------------------------------------------------------------ */

/**
 * Normalise un numéro saisi en E.164, en exigeant une ligne **mobile** : un SMS
 * envoyé sur une ligne fixe n'arrive jamais, et l'utilisateur resterait bloqué
 * sur un écran attendant un code qui ne viendra pas.
 *
 * @param {string} saisi   numéro tel que saisi (« 06 12 34 56 78 », « +33 6 … »)
 * @param {string} [pays]  pays par défaut pour un numéro national
 * @returns {?string} numéro E.164, ou null si invalide ou non mobile
 */
export function normaliserTelephone(saisi, pays = 'FR') {
    if (!saisi || typeof saisi !== 'string') return null;

    const numero = parsePhoneNumberFromString(saisi.trim(), pays);
    if (!numero || !numero.isValid()) return null;

    // MOBILE, ou l'indistinct MOBILE/FIXE de certains plans de numérotation.
    const type = numero.getType();
    if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;

    return numero.number;
}

/**
 * Numéro E.164 utilisable pour joindre un compte : celui en cours d'enrôlement
 * (déjà normalisé), sinon celui du profil.
 *
 * La normalisation n'est pas cosmétique : les API SMS exigent l'indicatif
 * pays, or 2766 des 2902 numéros renseignés sont au format national.
 * Renvoie null quand le profil ne porte rien d'exploitable — un fixe, par
 * exemple, sur lequel un SMS n'arriverait jamais.
 */
async function telephoneDuCompte(userId) {
    const ligne = await ligneTfa(userId);
    if (ligne?.telephone) return ligne.telephone;

    const user = await db('users').select('telephone').where('id', userId).first();
    return normaliserTelephone(String(user?.telephone || '').trim());
}

/* ------------------------------------------------------------------ */
/* Règle : qui doit une 2FA                                             */
/* ------------------------------------------------------------------ */

/** Lecture tolérante de l'option globale (absente = 2FA non forcée). */
async function forcerTfaGlobalement() {
    try {
        const valeur = await getOption('FORCER_TFA');
        return String(valeur) === '1';
    } catch {
        return false;
    }
}

/**
 * Décide si un compte doit passer par l'authentification forte.
 *
 * @param {number} userId
 * @returns {Promise<{requise:boolean, obligatoire:boolean, reglage:string, raison:string}>}
 *   `obligatoire` = exigée quel que soit le réglage (ultra admin) ;
 *   `reglage` = valeur du link `tfa` ('oui' | 'non' | 'defaut').
 */
export async function getTfaPolicy(userId) {
    const absente = { requise: false, obligatoire: false, reglage: 'defaut', raison: 'compte_inconnu' };
    if (!userId || isNaN(userId)) return absente;

    const user = await db('users').select('id', 'level', 'ultra_admin')
        .where('id', userId).where('trash', '<>', 1).first();
    if (!user) return absente;

    const lien = await db('links').select('valeur')
        .where({ table: 'users', cle: String(userId), champ: 'tfa' }).first();

    const reglage = ['oui', 'non'].includes(lien?.valeur) ? lien.valeur : 'defaut';
    const ultraAdmin = user.level === 'admin' && Number(user.ultra_admin) === 1;

    if (ultraAdmin) {
        return { requise: true, obligatoire: true, reglage, raison: 'ultra_admin' };
    }
    if (reglage === 'non') {
        return { requise: false, obligatoire: false, reglage, raison: 'exempte' };
    }
    if (reglage === 'oui') {
        return { requise: true, obligatoire: false, reglage, raison: 'reglage_compte' };
    }

    return await forcerTfaGlobalement()
        ? { requise: true, obligatoire: false, reglage, raison: 'option_globale' }
        : { requise: false, obligatoire: false, reglage, raison: 'non_active' };
}

/* ------------------------------------------------------------------ */
/* État d'un compte                                                     */
/* ------------------------------------------------------------------ */

/** Masque un numéro en ne laissant que les deux derniers chiffres. */
function masquerTelephone(numero) {
    const propre = String(numero || '').replace(/\s+/g, '');
    if (propre.length < 3) return null;
    return '••••••' + propre.slice(-2);
}

async function ligneTfa(userId) {
    return await db('users_tfa').where('user_id', userId).first();
}

/**
 * État 2FA d'un compte, tel que le SSO en a besoin pour décider quoi afficher.
 * Ne renvoie jamais de secret ni de code.
 *
 * @param {number} userId
 */
export async function getTfaEtat(userId) {
    const policy = await getTfaPolicy(userId);

    const user = await db('users').select('id', 'email', 'telephone')
        .where('id', userId).where('trash', '<>', 1).first();
    if (!user) {
        return {
            ...policy, enrole: false, methode: null, methodes: [],
            telephone: null, telephoneAuProfil: false, codesSecoursRestants: 0,
        };
    }

    const ligne = await ligneTfa(userId);
    // Numéro réellement utilisable, pas simplement présent : un fixe ou un
    // numéro incomplet au profil doit mener au tunnel de saisie, pas à un SMS
    // qui n'arrivera jamais.
    const telephone = ligne?.telephone || normaliserTelephone(String(user.telephone || '').trim());

    // Les deux moyens sont toujours proposables : 808 des 3710 comptes actifs
    // n'ont pas de numéro au profil, mais ils peuvent en saisir un — il sera
    // vérifié par un code avant d'être retenu (cf. demarrerEnrolement).
    const methodes = ['app', 'sms'];

    const codesSecoursRestants = ligne?.enrole_le
        ? Number((await db('users_tfa_codes').where({ user_id: userId })
            .whereNull('utilise_le').count({ n: '*' }).first())?.n || 0)
        : 0;

    return {
        ...policy,
        enrole: !!ligne?.enrole_le,
        methode: ligne?.enrole_le ? ligne.methode : null,
        methodes,
        telephone: masquerTelephone(telephone),
        // Faux quand le profil ne porte pas de numéro : l'appelant sait alors
        // qu'il doit le demander avant de pouvoir envoyer un code.
        telephoneAuProfil: !!telephone,
        bloqueJusqua: ligne?.bloque_jusqua || null,
        codesSecoursRestants,
    };
}

/* ------------------------------------------------------------------ */
/* Enrôlement                                                           */
/* ------------------------------------------------------------------ */

/**
 * Démarre un enrôlement. Pour la méthode `app`, génère un secret TOTP et
 * renvoie l'URI `otpauth://` que le SSO transformera en QR code. Le secret
 * n'est confirmé (et l'enrôlement effectif) qu'après un premier code valide,
 * via {@link confirmerEnrolement} : un enrôlement abandonné ne verrouille donc
 * jamais un compte.
 *
 * @param {number} userId
 * @param {'app'|'sms'} methode
 */
export async function demarrerEnrolement(userId, methode, telephoneSaisi = null) {
    const etat = await getTfaEtat(userId);
    if (!etat.methodes.includes(methode)) {
        throw new Error(`Méthode "${methode}" indisponible pour ce compte`);
    }

    const user = await db('users').select('id', 'email', 'telephone').where('id', userId).first();

    // État à restaurer si le nouveau moyen se révèle inutilisable (SMS refusé
    // par le fournisseur, par exemple) : démarrer un enrôlement ne doit jamais
    // laisser un compte moins protégé qu'avant de l'avoir tenté.
    const precedent = await ligneTfa(userId);

    const ligne = {
        user_id: userId, methode, enrole_le: null, dernier_pas: null,
        echecs: 0, bloque_jusqua: null, telephone: null,
    };
    let otpauth = null;

    if (methode === 'app') {
        const secret = base32Encode(crypto.randomBytes(20));
        ligne.secret = chiffrer(secret);

        const label = encodeURIComponent(`SO PRESS:${user.email}`);
        otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=SO%20PRESS&algorithm=SHA1&digits=${TOTP_CHIFFRES}&period=${TOTP_PAS}`;
    } else {
        ligne.secret = null;

        // Numéro saisi pendant l'enrôlement : on le retient ici, PAS encore au
        // profil. Il n'y sera recopié qu'une fois prouvé par un code reçu — un
        // numéro non vérifié dans users.telephone servirait de second facteur
        // à sa prochaine connexion sans que personne ne l'ait confirmé.
        if (telephoneSaisi) {
            const normalise = normaliserTelephone(telephoneSaisi);
            if (!normalise) throw new Error('Numéro de mobile invalide');
            ligne.telephone = normalise;
        } else if (!String(user.telephone || '').trim()) {
            throw new Error('Un numéro de mobile est nécessaire');
        }
    }

    await db('users_tfa').insert(ligne).onConflict('user_id').merge();

    // Les anciens codes de secours ne sont PAS supprimés ici : ils ne le seront
    // qu'à la confirmation, par genererCodesSecours. Un enrôlement entamé puis
    // abandonné laisse ainsi intacts les codes déjà remis à l'utilisateur.

    let envoi = null;
    if (methode === 'sms') {
        envoi = await envoyerCodeSms(userId);
        if (!envoi.ok) {
            await restaurerEnrolement(userId, precedent);
            // On n'accuse pas le numéro : l'échec vient tout aussi bien du
            // fournisseur (service SMS fermé, quota) que de la saisie.
            throw new Error(envoi.erreur === 'pas_de_telephone'
                ? 'Aucun numéro de mobile utilisable pour ce compte'
                : "Le code n'a pas pu être envoyé par SMS");
        }
    }

    return { methode, otpauth, telephone: envoi?.telephone ?? etat.telephone };
}

/**
 * Remet la ligne 2FA dans l'état où elle était avant une tentative d'enrôlement
 * ratée, ou la supprime si le compte n'était pas encore enrôlé.
 */
async function restaurerEnrolement(userId, precedent) {
    if (precedent) {
        await db('users_tfa').where('user_id', userId).update(precedent);
    } else {
        await db('users_tfa').where('user_id', userId).del();
    }
}

/**
 * Confirme l'enrôlement avec un premier code valide et délivre les codes de
 * secours. Ceux-ci sont renvoyés en clair UNE SEULE FOIS — la base n'en garde
 * que le haché.
 *
 * @returns {Promise<{ok:boolean, codesSecours?:string[]}>}
 */
export async function confirmerEnrolement(userId, code) {
    const ligne = await ligneTfa(userId);
    if (!ligne) return { ok: false, erreur: 'aucun_enrolement' };
    if (ligne.enrole_le) return { ok: false, erreur: 'deja_enrole' };

    const resultat = await verifierCode(userId, code, { pendantEnrolement: true });
    if (!resultat.ok) return resultat;

    await db('users_tfa').where('user_id', userId).update({ enrole_le: db.fn.now() });

    // Le code reçu prouve la possession du numéro : il rejoint le profil, mais
    // seulement s'il n'y en avait pas. On n'écrase jamais un numéro existant —
    // sinon quiconque connaît le mot de passe pourrait détourner le second
    // facteur d'un compte vers son propre téléphone.
    if (ligne.telephone) {
        await db('users').where('id', userId).where(function () {
            this.whereNull('telephone').orWhere('telephone', '');
        }).update({ telephone: ligne.telephone });
    }

    return { ok: true, codesSecours: await genererCodesSecours(userId) };
}

/** Régénère les codes de secours (les précédents sont invalidés). */
export async function genererCodesSecours(userId) {
    await db('users_tfa_codes').where('user_id', userId).del();

    const codes = [];
    for (let i = 0; i < NB_CODES_SECOURS; i++) {
        let code = '';
        for (let j = 0; j < 10; j++) {
            code += ALPHABET_SECOURS[crypto.randomInt(ALPHABET_SECOURS.length)];
        }
        codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
    }

    await db('users_tfa_codes').insert(
        codes.map((code) => ({ user_id: userId, code_hash: sha256(normaliserCodeSecours(code)) }))
    );

    return codes;
}

function normaliserCodeSecours(code) {
    return String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/* ------------------------------------------------------------------ */
/* Challenge SMS                                                        */
/* ------------------------------------------------------------------ */

/**
 * Génère un code à 6 chiffres et l'envoie par SMS. Le code n'est stocké que
 * haché : il n'existe en clair que dans le SMS (contrairement au dispositif
 * précédent, qui le déposait dans un cookie du navigateur).
 *
 * @returns {Promise<{ok:boolean, erreur?:string, attendre?:number}>}
 */
export async function envoyerCodeSms(userId) {
    const telephone = await telephoneDuCompte(userId);
    if (!telephone) return { ok: false, erreur: 'pas_de_telephone' };

    const ligne = await ligneTfa(userId);
    if (ligne?.sms_envoye_le) {
        const attendre = SMS_DELAI_RENVOI - Math.floor((Date.now() - new Date(ligne.sms_envoye_le).getTime()) / 1000);
        if (attendre > 0) return { ok: false, erreur: 'trop_tot', attendre };
    }

    const code = String(crypto.randomInt(1000000)).padStart(6, '0');

    await db('users_tfa').insert({
        user_id: userId,
        methode: ligne?.methode || 'sms',
        sms_code_hash: sha256(code),
        sms_expire_le: new Date(Date.now() + SMS_TTL * 1000),
        sms_envoye_le: new Date(),
    }).onConflict('user_id').merge(['sms_code_hash', 'sms_expire_le', 'sms_envoye_le']);

    const envoye = (await envoyerSms(
        telephone,
        `Votre code de connexion SO PRESS est ${code}. Il expire dans ${SMS_TTL / 60} minutes.`
    )).ok;

    if (!envoye) {
        // L'envoi a échoué : on efface le code ET l'horodatage, sinon
        // l'utilisateur resterait bridé une minute pour un SMS jamais reçu.
        await db('users_tfa').where('user_id', userId)
            .update({ sms_code_hash: null, sms_expire_le: null, sms_envoye_le: null });
        return { ok: false, erreur: 'envoi_impossible' };
    }

    return { ok: true, telephone: masquerTelephone(telephone) };
}

/* ------------------------------------------------------------------ */
/* Vérification                                                         */
/* ------------------------------------------------------------------ */

/**
 * Vérifie un code saisi : TOTP, code SMS, ou code de secours (essayés dans cet
 * ordre). Applique le verrou après {@link MAX_ECHECS} échecs consécutifs.
 *
 * @param {number} userId
 * @param {string} code
 * @param {{pendantEnrolement?:boolean}} [options] pendant l'enrôlement, la
 *   ligne n'a pas encore de `enrole_le` et les codes de secours n'existent pas.
 * @returns {Promise<{ok:boolean, erreur?:string, methode?:string, restantes?:number}>}
 */
export async function verifierCode(userId, code, { pendantEnrolement = false } = {}) {
    const ligne = await ligneTfa(userId);
    if (!ligne) return { ok: false, erreur: 'aucun_enrolement' };

    if (ligne.bloque_jusqua && new Date(ligne.bloque_jusqua) > new Date()) {
        return { ok: false, erreur: 'bloque', bloqueJusqua: ligne.bloque_jusqua };
    }

    const saisi = String(code || '').trim();
    if (!saisi) return await echec(userId, ligne);

    // 1. TOTP — le pas retenu est mémorisé pour interdire de rejouer le même
    //    code pendant les 30 s où il reste mathématiquement valide.
    if (ligne.secret) {
        const pas = totpVerifier(dechiffrer(ligne.secret), saisi, ligne.dernier_pas);
        if (pas !== null) {
            await reussite(userId, { dernier_pas: pas });
            return { ok: true, methode: 'app' };
        }
    }

    // 2. Code SMS en cours.
    if (ligne.sms_code_hash && ligne.sms_expire_le && new Date(ligne.sms_expire_le) > new Date()) {
        if (comparaisonConstante(ligne.sms_code_hash, sha256(saisi.replace(/\D/g, '')))) {
            await reussite(userId, { sms_code_hash: null, sms_expire_le: null });
            return { ok: true, methode: 'sms' };
        }
    }

    // 3. Code de secours à usage unique.
    if (!pendantEnrolement) {
        const hash = sha256(normaliserCodeSecours(saisi));
        const consommes = await db('users_tfa_codes')
            .where({ user_id: userId, code_hash: hash }).whereNull('utilise_le')
            .update({ utilise_le: db.fn.now() });

        if (consommes > 0) {
            await reussite(userId, {});
            const restantes = Number((await db('users_tfa_codes').where({ user_id: userId })
                .whereNull('utilise_le').count({ n: '*' }).first())?.n || 0);
            return { ok: true, methode: 'secours', restantes };
        }
    }

    return await echec(userId, ligne);
}

async function reussite(userId, champs) {
    await db('users_tfa').where('user_id', userId).update({
        ...champs,
        echecs: 0,
        bloque_jusqua: null,
        derniere_verif: db.fn.now(),
    });
}

async function echec(userId, ligne) {
    const echecs = Number(ligne.echecs || 0) + 1;
    const bloque = echecs >= MAX_ECHECS;

    await db('users_tfa').where('user_id', userId).update({
        echecs: bloque ? 0 : echecs,
        bloque_jusqua: bloque ? new Date(Date.now() + BLOCAGE_SECONDES * 1000) : null,
    });

    return bloque
        ? { ok: false, erreur: 'bloque', bloqueJusqua: new Date(Date.now() + BLOCAGE_SECONDES * 1000) }
        : { ok: false, erreur: 'code_invalide', restantes: MAX_ECHECS - echecs };
}

/* ------------------------------------------------------------------ */
/* Appareils de confiance                                               */
/* ------------------------------------------------------------------ */

/**
 * Enregistre un appareil de confiance et renvoie le jeton à déposer dans le
 * cookie du SSO. La base ne garde que le haché : le cookie n'est pas forgeable,
 * et un ultra admin peut révoquer tous les appareils d'un compte.
 */
export async function confierAppareil(userId, { libelle = null, ip = null } = {}) {
    const jeton = crypto.randomBytes(32).toString('hex');

    await db('users_tfa_appareils').insert({
        user_id: userId,
        token_hash: sha256(jeton),
        libelle: libelle ? String(libelle).slice(0, 255) : null,
        ip,
        expire_le: new Date(Date.now() + APPAREIL_JOURS * 86400 * 1000),
    });

    return { jeton, expireLe: new Date(Date.now() + APPAREIL_JOURS * 86400 * 1000), jours: APPAREIL_JOURS };
}

/**
 * Un jeton d'appareil dispense-t-il ce compte de saisir un code ?
 * Marque l'appareil comme utilisé et purge les jetons expirés au passage.
 */
export async function appareilDeConfiance(userId, jeton) {
    if (!jeton) return false;

    await db('users_tfa_appareils').where('expire_le', '<', new Date()).del();

    const maj = await db('users_tfa_appareils')
        .where({ user_id: userId, token_hash: sha256(jeton) })
        .where('expire_le', '>', new Date())
        .update({ derniere_utilisation: db.fn.now() });

    return maj > 0;
}

/** Révoque tous les appareils de confiance d'un compte. */
export async function revoquerAppareils(userId) {
    return await db('users_tfa_appareils').where('user_id', userId).del();
}

/**
 * Réinitialise complètement la 2FA d'un compte (perte de téléphone) : secret,
 * codes de secours et appareils de confiance. L'utilisateur devra se ré-enrôler
 * à sa prochaine connexion.
 */
export async function reinitialiserTfa(userId) {
    await db('users_tfa_codes').where('user_id', userId).del();
    await revoquerAppareils(userId);
    await db('users_tfa').where('user_id', userId).del();

    return { ok: true };
}
