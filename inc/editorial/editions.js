import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { httpError } from '../core/response.js';

/**
 * URL du PDF d'une édition : son URL S3 (`editions.url`, renseignée par SOGEST
 * à l'upload ou par la migration `crons/editions_vers_s3.php`), sinon, pour une
 * édition pas encore migrée, le fichier sur SOGEST (`uploads/editions/{id}.pdf`).
 * C'est le seul endroit de l'API qui connaisse ce chemin : les activités s'y
 * adressent aussi, via leur `edition_id`.
 *
 * L'existence du fichier n'est pas vérifiée — ce serait une requête HTTP par
 * édition sur une liste.
 *
 * @param {number|null} editionId
 * @param {string|null} [url] `editions.url`
 * @returns {string|null} `null` sans édition
 */
export function pdfEditionUrl(editionId, url = null) {
  if (!editionId) return null;
  return url || sogestUrl(`uploads/editions/${editionId}.pdf`);
}

/**
 * `editions.url` de plusieurs éditions, en une requête : pour les listes
 * d'activités, qui ne portent que l'`edition_id`.
 * @param {Array<number|null>} editionIds
 * @returns {Promise<Map<number, string>>}
 */
export async function urlsPdfEditions(editionIds) {
  const ids = [...new Set(editionIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db('editions').select('id', 'url').whereIn('id', ids);
  return new Map(rows.map((row) => [row.id, row.url]));
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
  return { ...edition, pdf: pdfEditionUrl(edition.id, edition.url), fiche: ficheEditionUrl(edition.id), envoi: envoiEdition(edition) };
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
