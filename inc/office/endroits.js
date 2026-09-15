import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { db } from '../../db.js';
import { slugify } from '../core/utils.js';
import { sogestUrl } from '../core/sogest.js';
import { saveToHistorique } from '../systeme/historique.js';

dayjs.extend(isoWeek);

/**
 * Les « endroits » réservables ne sont pas tous des lieux : une salle de
 * réunion, une salle de montage, mais aussi du matériel (caméra, micro…).
 * Mêmes libellés que sogest (`include/auto/endroits.inc.php`).
 */
export const TYPES_ENDROIT = {
  reunion: 'Salles de réunion',
  montage: 'Salles de montage',
  materiel: 'Matériel',
  autre: 'Autres',
};

/** Jours ouvrés affichés dans un planning hebdomadaire. */
export const JOURS = [
  { slug: 'lundi', nom: 'Lundi' },
  { slug: 'mardi', nom: 'Mardi' },
  { slug: 'mercredi', nom: 'Mercredi' },
  { slug: 'jeudi', nom: 'Jeudi' },
  { slug: 'vendredi', nom: 'Vendredi' },
];

/** Créneaux « en un clic » (matinée, après-midi, journée). */
export const CRENEAUX = [
  { icone: '☀', slug: 'matin', libelle: 'la matinée', debut: '08:00', fin: '12:00' },
  { icone: '🌃', slug: 'apres-midi', libelle: "l'après-midi", debut: '14:00', fin: '19:00' },
  { icone: '📅', slug: 'journee', libelle: 'toute la journée', debut: '08:00', fin: '19:00' },
];

/** Première et dernière heure de la grille de réservation (pas de 30 minutes). */
export const HEURE_OUVERTURE = 8;
export const HEURE_FERMETURE = 21;

/** Champs modifiables d'un endroit (`slug` et `modification` sont dérivés). */
const EDITABLE = [
  'libelle', 'description', 'type', 'id_equipe', 'ordre', 'coordonnees', 'lien',
  'ferme', 'message_ferme', 'notif', 'emails_dest', 'ip',
];

/**
 * Grille horaire : un pas de 30 minutes de {@link HEURE_OUVERTURE} à
 * {@link HEURE_FERMETURE}, chaque entrée portant son début et sa fin.
 * @returns {{debut: string, fin: string}[]}
 */
export function heuresDebutFin() {
  const out = [];
  for (let h = HEURE_OUVERTURE; h < HEURE_FERMETURE; h++) {
    for (const minutes of ['00', '30']) {
      const debut = `${String(h).padStart(2, '0')}:${minutes}`;
      const fin = minutes === '30'
        ? `${String(h + 1).padStart(2, '0')}:00`
        : `${String(h).padStart(2, '0')}:30`;
      out.push({ debut, fin });
    }
  }
  return out;
}

/** Libellé d'un type d'endroit (le slug lui-même s'il est inconnu). */
export function libelleType(type) {
  return TYPES_ENDROIT[type] || type || '';
}

/** Les types d'endroits, au format `{ slug, libelle }`. */
export function typesEndroits() {
  return Object.entries(TYPES_ENDROIT).map(([slug, libelle]) => ({ slug, libelle }));
}

/**
 * Extrait les adresses e-mail d'une chaîne libre (« a@b.com, c@d.com »).
 * @param {string} str
 * @returns {string[]}
 */
export function extraireEmails(str) {
  if (!str) return [];
  return String(str).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
}

/**
 * Lundi (YYYY-MM-DD) de la semaine ISO demandée.
 * @param {number} [semaine] Numéro de semaine ISO ; défaut : semaine courante
 * @param {number} [annee] Défaut : année courante
 * @returns {string}
 */
export function lundiDeLaSemaine(semaine = null, annee = null) {
  const today = dayjs();
  const year = annee || today.year();
  if (!semaine) return today.startOf('isoWeek').format('YYYY-MM-DD');
  // Le 4 janvier appartient toujours à la semaine ISO 1.
  return dayjs(`${year}-01-04`).startOf('isoWeek').add(semaine - 1, 'week').format('YYYY-MM-DD');
}

function normaliserSlug(libelle, id) {
  return slugify(libelle || '') || `endroit-${id || ''}`;
}

/**
 * Décore une ligne `endroits` : booléens, libellé de type, URL de l'écran et
 * destinataires de notification déjà découpés.
 */
function decorate(row) {
  if (!row) return null;
  const slug = row.slug || normaliserSlug(row.libelle, row.id);
  return {
    ...row,
    slug,
    ferme: !!row.ferme,
    notif: !!row.notif,
    ordre: Number(row.ordre) || 0,
    id_equipe: Number(row.id_equipe) || 0,
    type_libelle: libelleType(row.type),
    emails_notif: extraireEmails(row.emails_dest),
    // L'image d'écran (affichage e-ink devant les salles) reste générée par
    // sogest : l'API ne fait qu'en donner l'adresse.
    ecran: sogestUrl(`endroits/${slug}.png`, { t: Date.now() }),
  };
}

/**
 * Liste des endroits, hors corbeille.
 * @param {{type?: string, all?: boolean, equipeId?: number}} [options]
 *   `all` inclut les endroits fermés à la réservation.
 * @returns {Promise<Object[]>}
 */
export async function getEndroits({ type = null, all = true, equipeId = null } = {}) {
  const query = db('endroits')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy([{ column: 'ordre', order: 'asc' }, { column: 'libelle', order: 'asc' }]);

  if (type) query.andWhere('type', type);
  if (equipeId !== null) query.andWhere('id_equipe', equipeId);
  if (!all) query.andWhere('ferme', '<>', 1);

  return (await query).map(decorate);
}

/**
 * Récupère un endroit par son id numérique ou son slug.
 * @param {number|string} idOrSlug
 * @returns {Promise<Object|null>}
 */
export async function getEndroit(idOrSlug) {
  if (idOrSlug === undefined || idOrSlug === null || idOrSlug === '') return null;
  if (/^\d+$/.test(String(idOrSlug))) {
    const row = await db('endroits').select('*').where({ id: idOrSlug }).andWhere('trash', '<>', 1).first();
    return decorate(row) ?? null;
  }
  return getEndroitBySlug(idOrSlug);
}

/**
 * Récupère un endroit par son slug.
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
export async function getEndroitBySlug(slug) {
  const row = await db('endroits').select('*').where({ slug }).andWhere('trash', '<>', 1).first();
  if (row) return decorate(row);
  // Endroits anciens dont la colonne `slug` est vide : on retombe sur le slug
  // calculé depuis le libellé.
  const all = await getEndroits();
  return all.find((e) => e.slug === slug) ?? null;
}

/** Libellé de l'équipe rattachée, dénormalisé dans `endroits.equipe` comme sogest. */
async function libelleEquipe(id_equipe) {
  if (!id_equipe) return '';
  const row = await db('equipes').select('libelle').where({ id: id_equipe }).first();
  return row?.libelle || '';
}

/**
 * Nettoie et valide les champs d'un endroit venus de l'appelant.
 * @param {Object} data
 * @param {{partiel?: boolean}} [options]
 * @returns {Object} champs prêts pour l'insertion / la mise à jour
 */
function champsEndroit(data, { partiel = false } = {}) {
  const out = {};
  for (const field of EDITABLE) {
    if (data[field] === undefined) continue;
    let value = data[field];
    if (field === 'ferme' || field === 'notif') value = value ? 1 : 0;
    if (field === 'id_equipe' || field === 'ordre') value = parseInt(value, 10) || 0;
    if (field === 'emails_dest') value = extraireEmails(value).join(', ');
    if (value === null) value = '';
    out[field] = value;
  }
  if (!partiel && !out.libelle) {
    const err = new Error('Le libellé est obligatoire');
    err.code = 'libelle_requis';
    throw err;
  }
  if (out.type !== undefined && out.type && !TYPES_ENDROIT[out.type]) {
    const err = new Error(`Type inconnu : ${out.type}`);
    err.code = 'type_inconnu';
    throw err;
  }
  return out;
}

/** Slug unique dans la table (suffixé si nécessaire). */
async function slugUnique(base, { exclureId = null } = {}) {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = db('endroits').select('id').where({ slug });
    if (exclureId) query.andWhere('id', '<>', exclureId);
    if (!(await query.first())) return slug;
    slug = `${base}-${++n}`;
  }
}

/**
 * Crée un endroit réservable.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function createEndroit(data) {
  const champs = champsEndroit(data);
  champs.type = champs.type || 'autre';
  champs.equipe = await libelleEquipe(champs.id_equipe);
  champs.slug = await slugUnique(data.slug ? slugify(data.slug) : normaliserSlug(champs.libelle));
  champs.trash = 0;

  const [id] = await db('endroits').insert(champs);
  return await getEndroit(id);
}

/**
 * Met à jour un endroit. L'état précédent est versionné dans `historique`.
 * @param {number} id
 * @param {Object} data
 * @param {{auteur?: Object|null}} [options] Auteur tracé dans l'historique
 * @returns {Promise<Object|null>} l'endroit mis à jour
 */
export async function updateEndroit(id, data, { auteur = undefined } = {}) {
  const champs = champsEndroit(data, { partiel: true });
  if (data.slug !== undefined) {
    champs.slug = await slugUnique(slugify(data.slug) || normaliserSlug(data.libelle, id), { exclureId: id });
  }
  if (champs.id_equipe !== undefined) champs.equipe = await libelleEquipe(champs.id_equipe);
  if (!Object.keys(champs).length) return await getEndroit(id);

  await saveToHistorique('endroits', id, auteur);
  champs.modification = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db('endroits').where({ id }).update(champs);
  return await getEndroit(id);
}

/**
 * Met un endroit à la corbeille (suppression douce, comme sogest). Les
 * réservations déjà posées ne sont pas touchées.
 * @param {number} id
 * @param {{auteur?: Object|null}} [options]
 * @returns {Promise<boolean>}
 */
export async function deleteEndroit(id, { auteur = undefined } = {}) {
  await saveToHistorique('endroits', id, auteur);
  const count = await db('endroits').where({ id }).update({ trash: 1 });
  return count > 0;
}

/**
 * Enregistre l'adresse IP de l'écran posé devant un endroit (l'écran s'annonce
 * lui-même, comme `endroit.php?slug=…&ip=…` en legacy).
 * @param {number} id
 * @param {string} ip
 * @returns {Promise<Object|null>}
 */
export async function setIpEcran(id, ip) {
  await db('endroits').where({ id }).update({ ip, modification: dayjs().format('YYYY-MM-DD HH:mm:ss') });
  return await getEndroit(id);
}
