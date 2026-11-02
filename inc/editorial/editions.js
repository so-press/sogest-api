import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { httpError } from '../core/response.js';
import { apiBaseUrl } from '../core/request.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * URL du PDF d'une édition, **relayée par l'API** (`GET /editions/{id}/pdf`).
 *
 * Le fichier lui-même est sur le S3 de SOGEST (`editions.url`) ou, pour une
 * édition pas encore migrée, dans `uploads/editions/{id}.pdf` sur SOGEST
 * (cf. `sourcePdfEdition`). Ces adresses ne sont pas exposées : le bucket
 * n'envoie aucun en-tête CORS, un front ne peut donc pas les lire. L'API, elle,
 * exige le jeton comme partout et relaie le fichier.
 *
 * L'existence du fichier n'est pas vérifiée — ce serait une requête HTTP par
 * édition sur une liste.
 *
 * @param {number|null} editionId
 * @returns {string|null} `null` sans édition
 */
export function pdfEditionUrl(editionId) {
  if (!editionId) return null;
  return `${apiBaseUrl()}/editions/${encodeURIComponent(editionId)}/pdf`;
}

/**
 * Adresse réelle du PDF d'une édition : son URL S3 (`editions.url`, renseignée
 * par SOGEST à l'upload ou par la migration `crons/editions_vers_s3.php`),
 * sinon le fichier sur SOGEST. Usage serveur seulement (`relayerPdfEdition`).
 * @param {{id: number, url?: string|null}} edition
 * @returns {string}
 */
function sourcePdfEdition(edition) {
  return edition.url || sogestUrl(`uploads/editions/${edition.id}.pdf`);
}

// En-têtes de la réponse amont recopiés tels quels : de quoi laisser un lecteur
// PDF (pdf.js) télécharger par plages, et le navigateur mettre en cache.
const ENTETES_RELAYES = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/**
 * Relaie le PDF d'une édition dans `res`, en flux (un magazine pèse des
 * dizaines de Mo : il n'est jamais chargé en mémoire). Les en-têtes `Range`,
 * `If-None-Match` et `If-Modified-Since` du client sont transmis, d'où des
 * réponses 206 / 304 possibles.
 *
 * @param {number} id
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{telecharger?: boolean}} [options] `Content-Disposition: attachment` plutôt qu'`inline`
 * @throws {Error} 404 édition ou fichier introuvable, 502 stockage injoignable
 */
export async function relayerPdfEdition(id, req, res, { telecharger = false } = {}) {
  if (isNaN(id)) throw httpError(400, 'id_invalide', 'Identifiant d\'édition invalide');
  const edition = await db('editions').select('id', 'url', 'filename').where('id', id).where('trash', '<>', 1).first();
  if (!edition) throw httpError(404, 'edition_inconnue', 'Édition introuvable');

  const headers = {};
  for (const nom of ['range', 'if-none-match', 'if-modified-since', 'if-range']) {
    if (req.headers[nom]) headers[nom] = req.headers[nom];
  }
  // Fichier encore sur SOGEST : il reçoit le JWT de l'appelant, qu'il accepte
  // (même JWT_SECRET). Jamais transmis au S3, qui n'en a que faire.
  if (!edition.url && req.isJwt && req.headers.authorization) headers.authorization = req.headers.authorization;

  const source = sourcePdfEdition(edition);
  const stockage = edition.url ? 'S3' : 'SOGEST';
  // Délai sur l'arrivée des en-têtes seulement : le corps, lui, peut mettre
  // plus longtemps à descendre vers un client lent.
  const delai = new AbortController();
  const minuteur = setTimeout(() => delai.abort(new Error('délai dépassé')), 30000);
  let amont;
  try {
    amont = await fetch(source, { headers, redirect: 'manual', signal: delai.signal });
  } catch (e) {
    throw httpError(502, 'stockage_injoignable', `${stockage} injoignable : ${e.message}`);
  } finally {
    clearTimeout(minuteur);
  }

  if (amont.status === 404 || (amont.status === 403 && edition.url)) {
    // S3 répond 403 (et non 404) sur une clé absente d'un bucket non listable.
    throw httpError(404, 'pdf_introuvable', `PDF de l'édition ${id} introuvable sur ${stockage}`);
  }
  const ok = amont.ok || amont.status === 304 || amont.status === 416;
  if (!ok || (amont.headers.get('content-type') || '').includes('text/html')) {
    // Une redirection ou une page HTML : SOGEST renvoie vers son login.
    await amont.body?.cancel();
    throw httpError(502, 'stockage_reponse_inattendue', `${stockage} a répondu ${amont.status}`);
  }

  res.status(amont.status);
  for (const nom of ENTETES_RELAYES) {
    const valeur = amont.headers.get(nom);
    if (valeur) res.set(nom, valeur);
  }
  if (amont.status !== 304 && !amont.headers.get('content-type')?.includes('pdf')) res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', dispositionPdf(edition, telecharger));
  // Réponse propre à l'appelant authentifié : jamais dans un cache partagé.
  res.set('Cache-Control', 'private, max-age=3600');

  if (!amont.body || amont.status === 304) return res.end();
  try {
    await pipeline(Readable.fromWeb(amont.body), res);
  } catch (e) {
    // En-têtes déjà partis : plus rien à répondre. Le cas courant est un client
    // qui abandonne (pdf.js annule les plages dont il n'a plus besoin).
    if (e.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn(`PDF édition ${id} interrompu : ${e.message}`);
  }
}

/**
 * `Content-Disposition` du PDF, au nom du fichier de l'édition. Un en-tête HTTP
 * ne porte que du Latin-1 : `filename` en reçoit une version ASCII, `filename*`
 * le nom exact (RFC 6266).
 */
function dispositionPdf(edition, telecharger) {
  const nom = String(edition.filename || `edition-${edition.id}`).replace(/\.pdf$/i, '') + '.pdf';
  const ascii = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${telecharger ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

// Mois abrégés de `dateFr()` de SOGEST (« Jui. » = juin), dans l'ordre.
const MOIS_SOGEST = ['jan', 'fév', 'mar', 'avr', 'mai', 'jui', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const deux = (n) => String(n).padStart(2, '0');

/**
 * Dernier envoi d'une édition sur ses aiguillages : `{ le, serveurs, sur }` (`le` en heure de Paris,
 * « AAAA-MM-JJ HH:MM:SS », comme les autres dates de la table), ou `null` jamais envoyée.
 *
 * `editions.envoye_le` est posée par le cron de SOGEST depuis octobre 2026. Avant, la date n'est que
 * dans `messages` (« Envoyé vers 15 serveurs sur 15 - 25 Août 13:23 », l'année seulement si ce
 * n'était pas l'année en cours) : l'année manquante est celle de `modification`, ou la précédente si
 * le jour tomberait après (`modification` est toujours postérieure à l'envoi).
 */
function envoiEdition(edition) {
  const bilans = [...String(edition.messages || '').matchAll(
    /Envoyé vers (\d+) serveurs? sur (\d+) - (\d{1,2})(?:er)? ([^\s\d]+)(?: (\d{4}))?\s+(\d{2}):(\d{2})/gu,
  )];
  const dernier = bilans.at(-1);
  const bilan = dernier ? { serveurs: Number(dernier[1]), sur: Number(dernier[2]) } : null;
  if (edition.envoye_le) return { le: String(edition.envoye_le), serveurs: bilan?.serveurs ?? null, sur: bilan?.sur ?? null };
  if (!dernier || !bilan.serveurs) return null;

  const [, , , jour, moisTexte, annee, h, min] = dernier;
  const mois = MOIS_SOGEST.indexOf(moisTexte.toLowerCase().replace(/\.$/, '')) + 1;
  if (!mois) return null;
  const reference = String(edition.modification || '');
  let an = Number(annee) || Number(reference.slice(0, 4)) || new Date().getFullYear();
  const le = (a) => `${a}-${deux(mois)}-${deux(jour)} ${h}:${min}:00`;
  // Au jour près : `modification` est en UTC, les messages à l'heure de Paris.
  if (!annee && reference && le(an).slice(0, 10) > reference.slice(0, 10)) an -= 1;
  return { le: le(an), ...bilan };
}

/** Ajoute à une édition l'URL complète de son PDF, celle de sa fiche dans SOGEST et son dernier envoi. */
function avecPdf(edition) {
  if (!edition) return edition;
  return { ...edition, pdf: pdfEditionUrl(edition.id), fiche: ficheEditionUrl(edition.id), envoi: envoiEdition(edition) };
}

const SORTABLE = new Set(['publication', 'modification', 'numero', 'id']);

/**
 * Liste filtrée et triée des éditions.
 * @param {{supportId?: number, sort?: string, order?: 'asc'|'desc'}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listEditions({
  supportId = null,
  sort = 'publication',
  order = 'desc',
} = {}) {
  const query = db('editions').select('*').where('trash', '<>', 1);

  if (supportId !== null) {
    if (isNaN(supportId)) throw new Error('Invalid support ID');
    query.where('support_id', supportId);
  }

  const column = SORTABLE.has(String(sort)) ? sort : 'publication';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return (await query.orderBy(column, direction)).map(avecPdf);
}

/**
 * Récupère une édition par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getEdition(id) {
  if (isNaN(id)) throw new Error('Invalid edition ID');
  return avecPdf(await db('editions').where('id', id).where('trash', '<>', 1).first()) ?? null;
}

/**
 * Résout un id ou un slug de support en id numérique.
 * @param {string|number} idOrSlug
 * @returns {Promise<number|null>}
 */
export async function resolveSupportId(idOrSlug) {
  if (/^\d+$/.test(String(idOrSlug))) return parseInt(idOrSlug, 10);
  const row = await db('supports').select('id').where('slug', idOrSlug).where('trash', '<>', 1).first();
  return row?.id ?? null;
}

/** Valeur de `editions.origine` des éditions créées par cette API. */
export const ORIGINE_API = 'sogest-api';

/** Fiche d'une édition dans SOGEST (envois et messages des aiguillages). */
export const ficheEditionUrl = (id) => sogestUrl('index.php', { w: 'edit_edition', id, mode: 'office' });

/**
 * Crée une édition PDF et programme son envoi sur les FTP des aiguillages du
 * support, comme « Envoyer PDF » puis « Envoyer » dans SOGEST : c'est le cron
 * de SOGEST (`crons/editions.php`) qui envoie, dans la minute.
 *
 * - **Aiguillages** : tous ceux du support (la présélection du formulaire de
 *   SOGEST). Sans aucun, l'édition reste « en préparation » (`etat` waiting) :
 *   rien n'est envoyé, à compléter dans SOGEST.
 * - **PDF** : pas téléversé ici (le stockage de SOGEST n'est pas celui de l'API) ;
 *   `pdf_source` est une URL de téléchargement que SOGEST rapatrie au premier
 *   besoin, avant l'envoi. Elle doit donc rester valable quelques minutes.
 * - **Pages** : jamais générées par SOGEST (`genpages` -1, `origine`
 *   sogest-api), elles vivent dans So Librairie (`solib_url`, cible de « Voir
 *   les pages »).
 * - **Doublon** : une seule édition non supprimée par `solib_url`, et par
 *   support + numéro (numéro déjà envoyé depuis SOGEST) : 409 `edition_existante`,
 *   l'édition en place jointe ; pour renvoyer, « Relancer » dans SOGEST.
 *
 * @param {{support_id: number|string, numero: number|string, publication: string,
 *   pdf_url: string, fichier?: string, taille?: number, solib_url?: string}} data
 * @returns {Promise<{edition: Object, aiguillages: Object[], envoi: string, sogest_url: string}>}
 */
export async function diffuserEdition(data = {}) {
  const support = /^\d+$/.test(String(data.support_id ?? ''))
    ? await db('supports').select('id', 'nom').where('id', Number(data.support_id)).where('trash', '<>', 1).first()
    : null;
  if (!support) throw httpError(400, 'support_inconnu', 'Support SOGEST inconnu (support_id).');

  const numero = String(data.numero ?? '').trim();
  if (!/^\d+$/.test(numero) || !Number(numero)) {
    throw httpError(400, 'numero_invalide', 'Numéro entier requis (la colonne editions.numero est un entier).');
  }

  const publication = String(data.publication ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publication) || isNaN(Date.parse(publication))) {
    throw httpError(400, 'publication_invalide', 'Date de publication requise, au format AAAA-MM-JJ.');
  }

  let pdfUrl;
  try {
    pdfUrl = new URL(String(data.pdf_url ?? ''));
  } catch {
    pdfUrl = null;
  }
  if (!pdfUrl || !['https:', 'http:'].includes(pdfUrl.protocol)) {
    throw httpError(400, 'pdf_url_invalide', 'URL de téléchargement du PDF requise (pdf_url, http ou https).');
  }

  const solibUrl = String(data.solib_url ?? '').trim().slice(0, 255) || null;
  if (solibUrl) {
    const existante = await db('editions').where('solib_url', solibUrl).where('trash', '<>', 1).first();
    if (existante) {
      throw httpError(409, 'edition_existante', 'Ce magazine a déjà une édition dans SOGEST (« Relancer » depuis SOGEST pour la renvoyer).', {
        edition: avecPdf(existante),
        sogest_url: ficheEditionUrl(existante.id),
      });
    }
  }

  // Numéro déjà envoyé depuis SOGEST (avant So Librairie, ou à la main) : pas de second envoi
  // sur les FTP ; l'appelant rattache son magazine à l'édition en place.
  const memeNumero = await db('editions').where('support_id', support.id).where('numero', Number(numero))
    .where('trash', '<>', 1).orderBy('publication', 'desc').orderBy('id', 'desc').first();
  if (memeNumero) {
    throw httpError(409, 'edition_existante', `Le numéro ${numero} de ${support.nom} a déjà une édition dans SOGEST (« Relancer » depuis SOGEST pour la renvoyer).`, {
      edition: avecPdf(memeNumero),
      sogest_url: ficheEditionUrl(memeNumero.id),
    });
  }

  const aiguillages = await db('aiguillages').select('id', 'serveur', 'path', 'decalage_date_envoi')
    .where('support_id', support.id).where('trash', '<>', 1).orderBy('serveur');

  // editions.filename : 50 caractères ; l'extension est gardée.
  let fichier = String(data.fichier ?? '').trim().replace(/[\\/]/g, '-') || `${support.nom}-${numero}.pdf`;
  if (!/\.pdf$/i.test(fichier)) fichier += '.pdf';
  if (fichier.length > 50) fichier = `${fichier.slice(0, 46)}.pdf`;

  // Colonnes NOT NULL sans défaut toutes renseignées (mode SQL strict).
  const [id] = await db('editions').insert({
    entite_id: 0,
    entite: '',
    support_id: support.id,
    support: String(support.nom).slice(0, 50),
    url_xml_immanens: '',
    publication: `${publication} 00:00:00`,
    numero: Number(numero),
    genpages: -1,
    trim: 0,
    trash: 0,
    filesize: String(Number(data.taille) > 0 ? Math.round(Number(data.taille)) : 0),
    filename: fichier,
    url: '',
    etat: aiguillages.length ? 'ready' : 'waiting',
    messages: `<b>Créée par sogest-api (So Librairie) - ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</b>`,
    aiguillages: aiguillages.map((a) => a.id).join(','),
    watermark: 0,
    origine: ORIGINE_API,
    pdf_source: pdfUrl.href,
    solib_url: solibUrl,
  });

  return {
    edition: await getEdition(id),
    aiguillages: aiguillages.map((a) => ({
      id: a.id, serveur: a.serveur, chemin: a.path, decalage_jours: Number(a.decalage_date_envoi) || 0,
    })),
    envoi: aiguillages.length ? 'programme' : 'aucun_aiguillage',
    sogest_url: ficheEditionUrl(id),
  };
}
