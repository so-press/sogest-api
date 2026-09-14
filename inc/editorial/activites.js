import { db } from '../../db.js';
import { sogestUrl } from '../core/sogest.js';
import { urlExists } from '../core/utils.js';
import { saveToHistorique } from '../systeme/historique.js';

const SORTABLE = new Set(['libelle', 'id', 'periode', 'numero']);

/**
 * Liste des activités sélectionnables (hors corbeille / indisponibles), triées.
 *
 * Accès restreint (un des deux identifiants fourni) : ne renvoie que les
 * activités ayant au moins une pige (non corbeille) liée à `personneId`, ou
 * créées par l'utilisateur `userId` (`createur_id`).
 *
 * `supportId` restreint la liste aux activités d'un support donné.
 *
 * @param {{sort?: string, order?: 'asc'|'desc', personneId?: number|null, userId?: number|null, search?: string|null, supportId?: number|null}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listActivites({ sort = 'periode', order = 'desc', personneId = null, userId = null, search = null, supportId = null } = {}) {
  const query = db('activites')
    .select('*')
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1);

  if (supportId !== null) query.where('support_id', supportId);

  if (personneId !== null || userId !== null) {
    query.where(function () {
      this.whereExists(function () {
        this.select(db.raw('1'))
          .from('piges')
          .whereRaw('piges.activite_id = activites.id')
          .andWhere('piges.personne_id', personneId ?? 0)
          .andWhere('piges.trash', '<>', 1);
      });
      if (userId !== null) {
        this.orWhere('activites.createur_id', userId);
      }
    });
  }

  // Recherche plein-texte (LIKE) sur le libellé affiché.
  const term = String(search ?? '').trim();
  if (term) query.where('libelle', 'like', `%${term}%`);

  const column = SORTABLE.has(String(sort)) ? sort : 'periode';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return await query.orderBy(column, direction);
}

/**
 * Récupère une activité par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getActivite(id) {
  if (isNaN(id)) throw new Error('Invalid activite ID');
  return (await db('activites')
    .where('id', id)
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    .first()) ?? null;
}

/**
 * Vrai si l'utilisateur peut accéder à l'activité : il l'a créée
 * (`createur_id = userId`) ou il a au moins une pige (non corbeille) dessus
 * (`personne_id = personneId`).
 * @param {number} personneId
 * @param {number} userId
 * @param {number} activiteId
 * @returns {Promise<boolean>}
 */
export async function userCanAccessActivite(personneId, userId, activiteId) {
  const row = await db('activites')
    .select('activites.id')
    .where('activites.id', activiteId)
    .where('activites.trash', '<>', 1)
    .where(function () {
      this.where('activites.createur_id', userId ?? 0)
        .orWhereExists(function () {
          this.select(db.raw('1'))
            .from('piges')
            .whereRaw('piges.activite_id = activites.id')
            .andWhere('piges.personne_id', personneId ?? 0)
            .andWhere('piges.trash', '<>', 1);
        });
    })
    .first();
  return !!row;
}

/**
 * Extensions candidates pour le fichier `couverture.*` d'une activité,
 * dans l'ordre de préférence (le legacy stocke le fichier tel qu'uploadé).
 */
const COUVERTURE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/**
 * Cache mémoire des couvertures résolues : l'URL ne dépend que de l'id de
 * l'activité, et sur une liste entière les HEAD coûtent cher. Une couverture
 * trouvée ne bouge quasiment jamais → TTL long. TTL court sur les absences,
 * pour qu'une couverture fraîchement uploadée apparaisse vite.
 */
const COUVERTURE_TTL_TROUVEE_MS = 24 * 60 * 60 * 1000;
const COUVERTURE_TTL_ABSENTE_MS = 60 * 1000;
const couvertureCache = new Map();

/**
 * URL de la couverture d'une activité (`uploads/files/activites/{id}/couverture.*`
 * côté SOGEST), ou `null` si aucun fichier n'existe.
 * @param {number} activiteId
 * @returns {Promise<string|null>}
 */
export async function resolveCouvertureUrl(activiteId) {
  const cached = couvertureCache.get(activiteId);
  if (cached && cached.expire > Date.now()) return cached.url;

  const base = `uploads/files/activites/${activiteId}/couverture.`;

  // La première extension trouvée gagne : on s'arrête au premier HEAD positif
  // au lieu de tester les cinq systématiquement (cas nominal : 1 requête).
  let url = null;
  for (const ext of COUVERTURE_EXTENSIONS) {
    const candidate = sogestUrl(base + ext);
    if (await urlExists(candidate)) {
      url = candidate;
      break;
    }
  }

  couvertureCache.set(activiteId, {
    url,
    expire: Date.now() + (url ? COUVERTURE_TTL_TROUVEE_MS : COUVERTURE_TTL_ABSENTE_MS),
  });
  return url;
}

/**
 * Ajoute le champ `couverture` à chaque activité d'une liste, en bornant le
 * parallélisme des HEAD (une liste de magazine peut compter des centaines
 * d'activités).
 * @param {Object[]} activites
 * @param {number} [concurrence]
 * @returns {Promise<Object[]>}
 */
export async function withCouvertures(activites, concurrence = 8) {
  const out = new Array(activites.length);
  let curseur = 0;

  const worker = async () => {
    while (curseur < activites.length) {
      const index = curseur++;
      const row = activites[index];
      out[index] = { ...row, couverture: await resolveCouvertureUrl(row.id) };
    }
  };

  const workers = Math.min(concurrence, activites.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

/**
 * Dernière activité en date d'un support : la plus récente par `date_bouclage`
 * (les activités sans date de bouclage passent en dernier), `id` en départage.
 * Le champ `couverture` est résolu au passage.
 * @param {number} supportId
 * @returns {Promise<Object|null>}
 */
export async function getDerniereActivitePourSupport(supportId) {
  if (isNaN(supportId)) throw new Error('Invalid support ID');

  const row = await db('activites')
    .select('*')
    .where('support_id', supportId)
    .where('trash', '<>', 1)
    .where('indisponible', '<>', 1)
    // `YEAR() = 0` plutôt qu'une comparaison à '0000-00-00' : en sql_mode
    // strict, ce littéral de date invalide fait échouer la requête.
    .orderByRaw('(date_bouclage IS NULL OR YEAR(date_bouclage) = 0) asc')
    .orderBy('date_bouclage', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!row) return null;

  return { ...row, couverture: await resolveCouvertureUrl(row.id) };
}

/**
 * Champs « données de base » d'une activité, seuls modifiables par l'API.
 *
 * Tout ce qui relève de la saisie des piges (`piges`, `total`), du workflow de
 * clôture (`cloture*`, `okredac`), du blocage collaboratif (`blocage*`) ou de
 * la fusion de doublons (`fusion_id`) en est volontairement exclu : ces champs
 * sont posés par sogest au fil de ses propres traitements, et les écrire de
 * l'extérieur désynchroniserait les deux.
 *
 * `libelle` et `support` n'y figurent pas non plus : ils sont dérivés (cf.
 * `libelleActivite()`), comme dans sogest.
 */
const CHAMPS_MODIFIABLES = [
  'support_id',
  'edition_id',
  'numero',
  'periode',
  'projet',
  'version',
  'categorie',
  'support_mag',
  'date_bouclage',
  'description',
  'liens',
  'public',
  'indisponible',
];

/**
 * Libellé affiché d'une activité — port de `libelle_activite()` (sogest,
 * `include/auto/activites.inc.php`), variante texte brut.
 *
 * @param {Object} activite Données de l'activité (dont `support`, le nom)
 * @param {Object|null} support Ligne `supports` (pour `type_support`)
 * @returns {string}
 */
function libelleActivite(activite, support) {
  const supportNom = activite.support || 'Pas de support';
  const periode = activite.numero ? `#${activite.numero}` : (activite.periode || '');

  let libelle;
  if (Number(activite.support_mag)) {
    libelle = `Supplément du ${supportNom}` + (activite.numero ? ` n° ${activite.numero}` : '');
  } else if (support?.type_support === 'projets') {
    libelle = `${activite.projet || ''} [${supportNom}]`;
  } else {
    libelle = supportNom + (periode ? ` [ ${periode} ]` : '');
  }

  if (activite.version) libelle += ` ${activite.version}`;
  if (Number(activite.indisponible)) libelle += ' [Activite Indisponible]';

  return libelle;
}

/**
 * Récupère une activité sans filtrer sur `indisponible` (contrairement à
 * `getActivite()`) : une activité archivée reste modifiable et consultable
 * par son propriétaire. Seule la corbeille est exclue.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getActiviteBrute(id) {
  if (isNaN(id)) throw new Error('Invalid activite ID');
  return (await db('activites').where('id', id).where('trash', '<>', 1).first()) ?? null;
}

/** Ligne `supports` brute (sans filtre), pour le nom et le `type_support`. */
async function getSupportRow(supportId) {
  if (!supportId) return null;
  return (await db('supports').where('id', supportId).first()) ?? null;
}

/** Ne retient de `data` que les champs modifiables effectivement fournis. */
function champsFournis(data) {
  const out = {};
  for (const champ of CHAMPS_MODIFIABLES) {
    if (data?.[champ] !== undefined) out[champ] = data[champ];
  }
  return out;
}

/**
 * Crée une activité.
 *
 * `support` (le nom) et `libelle` sont dérivés du support, comme le fait
 * `insertActivite()` côté sogest ; l'auteur renseigne `createur`/`createur_id`.
 *
 * @param {Object} data Champs de `CHAMPS_MODIFIABLES`
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<Object>} L'activité créée
 * @throws {Error} `err.code = 'support_inconnu'` si `support_id` ne résout pas
 */
export async function createActivite(data, auteur = null) {
  const champs = champsFournis(data);

  const support = await getSupportRow(champs.support_id);
  if (!support) {
    const err = new Error('Support inconnu');
    err.code = 'support_inconnu';
    throw err;
  }

  const row = {
    ...champs,
    support: support.nom,
    createur: auteur?.nomComplet || 'api',
    createur_id: auteur?.id || 0,
    date_creation: new Date(),
  };
  row.libelle = libelleActivite(row, support);

  const [id] = await db('activites').insert(row);
  return await getActiviteBrute(id);
}

/**
 * Met à jour les données de base d'une activité.
 *
 * L'état précédent part dans `historique` avant écriture. Le libellé est
 * recalculé sur l'activité fusionnée (valeurs actuelles + modifications), et
 * un changement de `indisponible` se répercute sur `piges.hidden`, comme
 * `archiverActivite()` côté sogest.
 *
 * @param {number} id
 * @param {Object} data Champs de `CHAMPS_MODIFIABLES`
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<Object|null>} L'activité à jour, ou `null` si introuvable
 * @throws {Error} `err.code = 'support_inconnu'` / `'aucun_champ'`
 */
export async function updateActivite(id, data, auteur = null) {
  const actuelle = await getActiviteBrute(id);
  if (!actuelle) return null;

  const champs = champsFournis(data);
  if (Object.keys(champs).length === 0) {
    const err = new Error('Aucun champ à mettre à jour');
    err.code = 'aucun_champ';
    throw err;
  }

  if (champs.support_id !== undefined) {
    const support = await getSupportRow(champs.support_id);
    if (!support) {
      const err = new Error('Support inconnu');
      err.code = 'support_inconnu';
      throw err;
    }
    champs.support = support.nom;
  }

  const fusion = { ...actuelle, ...champs };
  champs.libelle = libelleActivite(fusion, await getSupportRow(fusion.support_id));
  champs.modificateur = auteur?.nomComplet || 'api';
  champs.modificateur_id = auteur?.id || 0;
  champs.modifications = Number(actuelle.modifications || 0) + 1;

  await saveToHistorique('activites', id, auteur);
  await db('activites').where('id', id).update(champs);

  // Archivage / désarchivage : les piges suivent l'activité.
  if (champs.indisponible !== undefined && Number(champs.indisponible) !== Number(actuelle.indisponible)) {
    await db('piges').where('activite_id', id).update({ hidden: Number(champs.indisponible) ? 1 : 0 });
  }

  return await getActiviteBrute(id);
}

/**
 * Met une activité à la corbeille — et ses piges avec elle, comme
 * `effacerActivite()` côté sogest. Rien n'est supprimé en base.
 *
 * @param {number} id
 * @param {{id?: number, nomComplet?: string}|null} [auteur]
 * @returns {Promise<boolean>} `false` si l'activité n'existait pas (ou était
 *   déjà en corbeille)
 */
export async function trashActivite(id, auteur = null) {
  const actuelle = await getActiviteBrute(id);
  if (!actuelle) return false;

  await saveToHistorique('activites', id, auteur);
  await db('activites').where('id', id).update({
    trash: 1,
    modificateur: auteur?.nomComplet || 'api',
    modificateur_id: auteur?.id || 0,
    modifications: Number(actuelle.modifications || 0) + 1,
  });
  await db('piges').where('activite_id', id).update({ trash: 1 });

  return true;
}
