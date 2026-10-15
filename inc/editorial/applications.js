import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { urlExists } from '../core/utils.js';
import { getOption } from '../core/options.js';
import { httpError } from '../core/response.js';

// Les logos sont des fichiers déposés par sogest (uploads/files/<type>/<id>/logo.*).
// Chaque résolution coûte des HEAD HTTP : on garde le résultat quelques minutes.
const LOGO_TTL_MS = 5 * 60 * 1000;
const logoCache = new Map();

async function resolveLogo(type, id) {
  const key = `${type}/${id}`;
  const hit = logoCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;

  const base = `uploads/files/${type}/${id}/`;
  let url = null;
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const candidate = sogestUrl(`${base}logo.${ext}`);
    if (await urlExists(candidate)) { url = candidate; break; }
  }
  logoCache.set(key, { url, exp: Date.now() + LOGO_TTL_MS });
  return url;
}

// Ordre d'affichage voulu par sogest (option ORDRE_APPLICATIONS : liste d'ids),
// les applications non listées suivent par ordre alphabétique.
async function ordreApplications() {
  try {
    const raw = await getOption('ORDRE_APPLICATIONS');
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.map(Number) : [];
  } catch {
    return [];
  }
}

function tri(applications, ordre) {
  const rang = (a) => {
    const i = ordre.indexOf(a.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return applications.sort((a, b) => rang(a) - rang(b) || a.nom.localeCompare(b.nom, 'fr'));
}

async function groupesParApplication() {
  const liens = await db('lien_application_groupe as l')
    .join('applications_groupes as g', 'g.id', 'l.groupe_id')
    .where('g.trash', 0)
    .select('l.application_id', 'l.groupe_id');
  const map = new Map();
  for (const { application_id, groupe_id } of liens) {
    if (!map.has(application_id)) map.set(application_id, []);
    map.get(application_id).push(groupe_id);
  }
  return map;
}

async function formaterApplication(row, groupes) {
  return {
    id: row.id,
    nom: row.nom,
    description: row.description,
    url: row.url,
    tags: row.tags,
    categorie: row.categorie,
    couleur_dominante: row.couleur_dominante || null,
    actif: !!row.actif,
    logo: await resolveLogo('applications', row.id),
    groupes: groupes.get(row.id) || [],
  };
}

/**
 * Applications. Par défaut seules les applications actives, dans l'ordre de
 * sogest ; `groupeId` restreint à un groupe, `toutes` inclut les inactives.
 */
export async function getApplications({ groupeId = null, toutes = false } = {}) {
  const query = db('applications');
  if (!toutes) query.where('actif', 1);
  if (groupeId) {
    query.whereIn('id', db('lien_application_groupe').where('groupe_id', groupeId).select('application_id'));
  }
  const [rows, groupes, ordre] = await Promise.all([query, groupesParApplication(), ordreApplications()]);
  const applications = await Promise.all(rows.map((r) => formaterApplication(r, groupes)));
  return tri(applications, ordre);
}

export async function getApplication(id) {
  const row = await db('applications').where('id', id).first();
  if (!row) throw httpError(404, 'application_inconnue', `Application ${id} introuvable`);
  return formaterApplication(row, await groupesParApplication());
}

async function formaterGroupe(row, compteurs) {
  return {
    id: row.id,
    nom: row.nom,
    description: row.description,
    ordre: row.ordre,
    logo: await resolveLogo('applications_groupes', row.id),
    nb_applications: compteurs.get(row.id) || 0,
  };
}

async function compteursParGroupe() {
  const rows = await db('lien_application_groupe as l')
    .join('applications as a', 'a.id', 'l.application_id')
    .where('a.actif', 1)
    .groupBy('l.groupe_id')
    .select('l.groupe_id', db.raw('COUNT(*) as n'));
  return new Map(rows.map((r) => [r.groupe_id, Number(r.n)]));
}

/** Groupes d'applications (hors corbeille), triés par `ordre` puis par nom. */
export async function getGroupes() {
  const [rows, compteurs] = await Promise.all([
    db('applications_groupes').where('trash', 0).orderBy([{ column: 'ordre' }, { column: 'nom' }]),
    compteursParGroupe(),
  ]);
  return Promise.all(rows.map((r) => formaterGroupe(r, compteurs)));
}

export async function getGroupe(id) {
  const row = await db('applications_groupes').where({ id, trash: 0 }).first();
  if (!row) throw httpError(404, 'groupe_inconnu', `Groupe ${id} introuvable`);
  return formaterGroupe(row, await compteursParGroupe());
}
