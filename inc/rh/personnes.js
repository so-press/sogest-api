import { db } from '../../db.js';
import { saveToHistorique } from '../systeme/historique.js';
import { getOption } from '../core/options.js';
import { removeAccents, slugify, toDate } from '../core/utils.js';
import { sogestUrl } from '../core/sogest.js';


export async function getPermanents() {
  const contrats = await getOption('CONTRATS_PERMANENTS', { filter: 'csv' });
  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .where('contrat', 'in', contrats)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}
/**
 * Permanents disposant d'un compte utilisateur actif, filtrés par une recherche
 * « façon slug » (insensible à la casse, aux accents et à la ponctuation) sur le
 * nom, le prénom, le nom complet dans les deux ordres et l'email.
 *
 * Le `user_id` renvoyé est celui du compte `users` rattaché à la personne
 * (jointure sur `users.personne_id`, avec repli sur la colonne
 * `personnes.user_id`). Les personnes sans compte sont exclues : elles n'ont pas
 * de planning d'absences, qui est porté par le compte utilisateur.
 *
 * @param {{search?: string, id?: number, limit?: number}} [options]
 * @param {number} [options.id] Restreint à une personne précise (résolution d'un
 *   `personne_id` reçu en URL : renvoie 0 ou 1 élément, et rien si la personne
 *   n'est pas un permanent ou n'a pas de compte).
 * @returns {Promise<Object[]>} `{ id, user_id, nom, prenom, nom_complet, email, contrat, equipe, photo }`
 */
export async function searchPermanents({ search = null, id = null, limit = 20 } = {}) {
  const contrats = await getOption('CONTRATS_PERMANENTS', { filter: 'csv' });

  const rows = await db('personnes as p')
    .leftJoin('users as u', function () {
      this.on('u.personne_id', '=', 'p.id')
        .andOn('u.trash', '<>', db.raw('1'))
        .andOn('u.actif', '=', db.raw('1'));
    })
    .select(
      'p.id',
      'p.nom',
      'p.prenom',
      'p.email',
      'p.contrat',
      'p.equipe',
      'p.photo',
      db.raw('COALESCE(u.id, p.user_id) as user_id'),
    )
    .where('p.trash', '<>', 1)
    .whereIn('p.contrat', contrats)
    .modify((q) => {
      if (id !== null) {
        if (isNaN(id)) throw new Error('Invalid personne ID');
        q.where('p.id', id);
      }
    })
    .orderBy([{ column: 'p.nom', order: 'asc' }, { column: 'p.prenom', order: 'asc' }]);

  // Le filtrage est fait en JS (et non en SQL LIKE) pour rester insensible aux
  // accents et à la ponctuation : « ELOI », « éloi » et « Éloi-Jean » matchent
  // le même slug. Le volume (quelques centaines de permanents) le permet.
  const terme = slugify(String(search ?? ''));

  const resultats = rows
    .filter((p) => Number(p.user_id) > 0)
    .map((p) => ({
      ...p,
      user_id: Number(p.user_id),
      nom_complet: [p.prenom, p.nom].filter(Boolean).join(' '),
    }))
    .filter((p) => {
      if (!terme) return true;
      const cibles = [
        slugify(p.nom || ''),
        slugify(p.prenom || ''),
        slugify(p.prenom || '', p.nom || ''),
        slugify(p.nom || '', p.prenom || ''),
        slugify(p.email || ''),
      ];
      return cibles.some((c) => c.includes(terme));
    });

  const max = Number(limit);
  return Number.isFinite(max) && max > 0 ? resultats.slice(0, max) : resultats;
}

/**
 * Liste des personnes non corbeille, triées nom/prénom.
 * @returns {Promise<Object[]>}
 */
export async function getPersonnes() {

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1)
    .orderBy([{ column: 'nom', order: 'desc' }, { column: 'prenom', order: 'desc' }]);

  return (await query).map(formaterPersonne);
}

/**
 * Teste si une URL répond (fichier présent sur le serveur de fichiers SOGEST).
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function urlExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * URL de la pièce d'identité d'une personne, si un fichier existe. Le fichier
 * n'est pas en base (uploadé depuis l'admin PHP dans uploads/files/personnes/{id}/),
 * on teste donc les extensions autorisées par ce formulaire (doc, pdf, docx).
 * @param {number} id
 * @returns {Promise<string|null>}
 */
async function resolvePieceIdentiteUrl(id) {
  const base = `uploads/files/personnes/${id}/`;
  for (const ext of ['pdf', 'doc', 'docx']) {
    const url = sogestUrl(`${base}piece-identite.${ext}`);
    if (await urlExists(url)) return url;
  }
  return null;
}

/**
 * Récupère une personne par id (ou user_id).
 * @param {{id?: number, personne_id?: number, user_id?: number}} [options]
 * @returns {Promise<Object|undefined>}
 */
export async function getPersonne(options = {}) {
  const user_id = options.user_id || null;
  const id = options.id || options.personne_id || null;

  const query = db('personnes')
    .select('*')
    .where('trash', '<>', 1);

  if (user_id) {
    query.andWhere('user_id', user_id);
  }

  if (id) {
    query.andWhere('id', id);
  }

  const row = await query.first();
  if (!row) return undefined;

  const personne = formaterPersonne(row);
  personne.piece_identite_url = await resolvePieceIdentiteUrl(personne.id);
  return personne;
}

/**
 * Récupère les congés stockés dans `meta.conges` d'une personne.
 * @param {number} personneId
 * @returns {Promise<Object|null>} l'objet congés, ou null s'il n'existe pas
 */
export async function getConges(personneId) {
  const personne = await getPersonne({ id: personneId });
  if (!personne) return null;

  let meta = personne.meta;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return null;
    }
  }

  return meta?.conges ?? null;
}

/**
 * Formate une entrée personne issue de la base.
 *
 * @param {Object} personne - Données brutes de la personne
 * @returns {Object} Données formatées
 */
function formaterPersonne(personne) {
  if (!personne) return null;
  personne.date_naissance = toDate(personne.date_naissance)
  return personne;
}
/**
 * Met à jour une personne (champs whitelistés, sauvegarde l'état dans l'historique).
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<number>} nombre de lignes modifiées
 */
export async function updatePersonne(id, data) {
  if (!data) return;

  await saveToHistorique('personnes', id);

  const allowedFields = [
    'nom',
    'prenom',
    'email',
    'email_perso',
    'telephone',
    'date_naissance',
    'lieu_naissance',
    'pays_naissance',
    'nationalite',
    'adresse',
    'code_postal',
    'ville',
    'pays',
    'equipe',
    'equipe_id',
    'fonction',
    'contrat',
    'transport',
    'securite_sociale',
    'mutuelle',
    'deduction_forfaitaire',
    'iban',
    'bic',
    'numero_carte_presse',
    'date_carte_presse',
    'nom_usage',
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  if (data.prenom !== undefined) {
    updateData.prenom_raw = removeAccents(data.prenom);
  }
  if (data.nom !== undefined) {
    updateData.nom_raw = removeAccents(data.nom);
  }

  if (data.prenom !== undefined || data.nom !== undefined) {
    const prenom = data.prenom !== undefined ? data.prenom : (await db('personnes').where({ id }).where('trash', '<>', 1).first()).prenom;
    const nom = data.nom !== undefined ? data.nom : (await db('personnes').where({ id }).where('trash', '<>', 1).first()).nom;
    updateData.slug = slugify(nom, prenom);
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('Aucun champ à mettre à jour');
  }

  return await db('personnes')
    .where({ id })
    .update(updateData);
}
