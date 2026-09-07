import crypto from 'node:crypto';

/**
 * Envoi de SMS transactionnels, indépendant du fournisseur.
 *
 * Le fournisseur est choisi par `SMS_PROVIDER` (`brevo` | `ovh`). Les appelants
 * n'utilisent que {@link envoyerSms} et ne savent rien du fournisseur retenu.
 *
 * Deux implémentations coexistent parce que l'émission SMS demande, chez chaque
 * opérateur, une validation manuelle du compte et de l'émetteur : pouvoir
 * basculer par variable d'environnement évite d'être bloqué par l'un d'eux.
 *
 * Les numéros doivent être fournis en E.164 (`+33612345678`) : les deux API
 * exigent l'indicatif pays.
 */

const TIMEOUT_MS = 10000;

/** Fournisseur configuré, `brevo` par défaut. */
export function smsProvider() {
    return (process.env.SMS_PROVIDER || 'brevo').trim().toLowerCase();
}

/**
 * Envoie un SMS transactionnel.
 *
 * @param {string} destinataire  numéro au format E.164
 * @param {string} contenu       texte du message
 * @returns {Promise<{ok:boolean, provider:string, erreur?:string, detail?:string}>}
 */
export async function envoyerSms(destinataire, contenu) {
    const provider = smsProvider();

    if (!destinataire || !contenu) {
        return { ok: false, provider, erreur: 'parametres_manquants' };
    }

    try {
        switch (provider) {
            case 'ovh':
                return await envoyerSmsOvh(destinataire, contenu);
            case 'brevo':
                return await envoyerSmsBrevo(destinataire, contenu);
            default:
                console.error(`[sms] SMS_PROVIDER inconnu : « ${provider} »`);
                return { ok: false, provider, erreur: 'provider_inconnu' };
        }
    } catch (err) {
        console.error(`[sms] ${provider} : ${err.message}`);
        return { ok: false, provider, erreur: 'exception', detail: err.message };
    }
}

/* ------------------------------------------------------------------ */
/* Brevo                                                               */
/* ------------------------------------------------------------------ */

async function envoyerSmsBrevo(destinataire, contenu) {
    const cle = process.env.BREVO_SMS_API_KEY;
    if (!cle) {
        console.error('[sms] BREVO_SMS_API_KEY non configurée');
        return { ok: false, provider: 'brevo', erreur: 'non_configure' };
    }

    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': cle, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
            type: 'transactional',
            unicodeEnabled: false,
            sender: process.env.SMS_SENDER || 'SOPRESS',
            recipient: destinataire,
            content: contenu,
            tag: 'tfa, sogest',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.error(`[sms] Brevo a répondu ${res.status} : ${detail}`);
        return { ok: false, provider: 'brevo', erreur: 'refus_fournisseur', detail };
    }

    return { ok: true, provider: 'brevo' };
}

/* ------------------------------------------------------------------ */
/* OVH                                                                 */
/* ------------------------------------------------------------------ */

function ovhEndpoint() {
    return (process.env.OVH_ENDPOINT || 'https://eu.api.ovh.com/1.0').replace(/\/+$/, '');
}

/**
 * Horloge de l'API OVH. La signature est refusée si l'horodatage s'écarte de
 * plus de quelques secondes du serveur : on mesure une fois le décalage local
 * puis on l'applique, plutôt que de faire un appel réseau par SMS.
 */
let ecartHorloge = null;
async function ovhTimestamp() {
    if (ecartHorloge === null) {
        try {
            const res = await fetch(ovhEndpoint() + '/auth/time', { signal: AbortSignal.timeout(TIMEOUT_MS) });
            const distant = parseInt((await res.text()).trim(), 10);
            ecartHorloge = Number.isFinite(distant) ? distant - Math.floor(Date.now() / 1000) : 0;
        } catch {
            ecartHorloge = 0;
        }
    }
    return Math.floor(Date.now() / 1000) + ecartHorloge;
}

/**
 * Signature OVH : `$1$` + sha1(secret+consumer+méthode+url+corps+horodatage),
 * les six éléments joints par des `+`.
 */
function ovhSignature(secret, consumer, methode, url, corps, horodatage) {
    const empreinte = crypto.createHash('sha1')
        .update([secret, consumer, methode, url, corps, horodatage].join('+'))
        .digest('hex');
    return '$1$' + empreinte;
}

/** Appel signé de l'API OVH. */
async function ovhRequete(methode, chemin, corpsObjet = null) {
    const { OVH_APP_KEY: appKey, OVH_APP_SECRET: appSecret, OVH_CONSUMER_KEY: consumerKey } = process.env;
    if (!appKey || !appSecret || !consumerKey) {
        throw new Error('OVH_APP_KEY, OVH_APP_SECRET et OVH_CONSUMER_KEY sont requis');
    }

    const url = ovhEndpoint() + chemin;
    const corps = corpsObjet ? JSON.stringify(corpsObjet) : '';
    const horodatage = await ovhTimestamp();

    const res = await fetch(url, {
        method: methode,
        headers: {
            'Content-Type': 'application/json',
            'X-Ovh-Application': appKey,
            'X-Ovh-Consumer': consumerKey,
            'X-Ovh-Timestamp': String(horodatage),
            'X-Ovh-Signature': ovhSignature(appSecret, consumerKey, methode, url, corps, horodatage),
        },
        body: corps || undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texte = await res.text();
    if (!res.ok) {
        const erreur = new Error(`OVH ${methode} ${chemin} → ${res.status} : ${texte.slice(0, 300)}`);
        erreur.status = res.status;
        erreur.detail = texte.slice(0, 300);
        throw erreur;
    }

    return texte ? JSON.parse(texte) : null;
}

/**
 * Nom du service SMS OVH (« sms-ab12345-1 »). Configuré par `OVH_SMS_SERVICE`,
 * sinon découvert une fois auprès de l'API — un compte n'en a généralement
 * qu'un seul, et l'exiger en configuration serait une source d'erreur de plus.
 */
let serviceSms = null;
async function ovhServiceSms() {
    if (process.env.OVH_SMS_SERVICE) return process.env.OVH_SMS_SERVICE;

    if (serviceSms === null) {
        const services = await ovhRequete('GET', '/sms');
        if (!Array.isArray(services) || !services.length) {
            throw new Error('Aucun service SMS sur ce compte OVH');
        }
        serviceSms = services[0];
    }

    return serviceSms;
}

async function envoyerSmsOvh(destinataire, contenu) {
    const service = await ovhServiceSms();

    const reponse = await ovhRequete('POST', `/sms/${encodeURIComponent(service)}/jobs`, {
        charset: 'UTF-8',
        coding: '7bit',
        message: contenu,
        // Message de service et non de prospection : la mention « STOP » ne
        // s'applique pas, et l'ajouter amputerait le texte utile.
        noStopClause: true,
        priority: 'high',
        receivers: [destinataire],
        sender: process.env.SMS_SENDER || 'SOPRESS',
        senderForResponse: false,
        validityPeriod: 2880,
    });

    // OVH répond 200 même quand il a écarté le destinataire : c'est
    // `invalidReceivers` qui fait foi, pas le code HTTP.
    const invalides = reponse?.invalidReceivers ?? [];
    if (invalides.length || !(reponse?.validReceivers ?? []).length) {
        console.error(`[sms] OVH a écarté le destinataire : ${JSON.stringify(invalides)}`);
        return { ok: false, provider: 'ovh', erreur: 'destinataire_refuse' };
    }

    return { ok: true, provider: 'ovh', detail: `${reponse.totalCreditsRemoved} crédit(s)` };
}
