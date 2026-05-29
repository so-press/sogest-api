import dayjs from 'dayjs';
import { db } from '../db.js';
import { getSupport } from './supports.js';
import { getPersonne } from './personnes.js';
import { getTauxDevise } from './devises.js';

export const NDF_PROJET_TYPE = { PROJET: 1, ACTIVITE: 2, LIBRE: 3 };
export const NDF_ETATS = ['brouillon', 'a-traiter', 'a-corriger', 'validee', 'payee', 'archivee', 'vide'];

// États dans lesquels la saisie (dépenses + champs) reste modifiable.
// Aligné sur ndfIs($ndf, 'brouillon') de Sogest : brouillon OU a-corriger.
const ETATS_EDITABLES = new Set(['brouillon', 'a-corriger']);

const SORTABLE_NDF = new Set(['modification', 'creation', 'periode', 'ttc', 'id']);
const EDITABLE_NDF = ['support_id', 'cb', 'nom_cb', 'periode', 'projet', 'projet_id', 'projet_type', 'activite_id', 'devise', 'remarque'];
const EDITABLE_DEPENSE = ['type_depense', 'support_id', 'projet', 'date_depense', 'libelle', 'etablissement', 'devise', 'ordre', 'justificatif'];

const money = (v) => (Math.round((parseFloat(v) || 0) * 100) / 100).toFixed(2);

/**
 * Taux de conversion d'une dépense vers l'EUR (devise de référence). EUR = 1.
 * Si le taux est indisponible (source externe), on retombe sur 1 (pas de
 * conversion) plutôt que d'échouer la sauvegarde.
 * @param {string} devise  code de la dépense
 * @param {string} date    date de la dépense (YYYY-MM-DD)
 * @returns {Promise<number>} taux tel que montant_eur = montant_devise / taux
 */
async function tauxVersEur(devise, date) {
  const code = String(devise || 'EUR').toUpperCase();
  if (code === 'EUR') return 1;
  const taux = await getTauxDevise(code, date);
  return taux && taux > 0 ? taux : 1;
}

/**
 * Convertit un montant vers l'EUR (montant_eur = montant / taux), en PLEINE
 * précision et SANS arrondi par ligne — comme Sogest `deviseConvertion`.
 * L'arrondi des sommes n'intervient qu'au total / à l'affichage : arrondir
 * chaque ligne avant de sommer introduirait une dérive de quelques centimes.
 * @returns {string} montant converti, non arrondi
 */
const toEur = (montant, taux) => String((parseFloat(montant) || 0) / (taux || 1));

/**
 * Reconvertit en EUR les montants `*_final` d'une dépense quand la conversion
 * stockée est absente ou suspecte, et persiste le résultat. Réplique la
 * reconversion à l'affichage de Sogest (afficherDepenses -> updateLignesNdf
 * 'auto'), nécessaire pour les dépenses créées hors API ou dont le taux à date
 * avait échoué (fallback taux=1 laissant `*_final` dans la devise étrangère).
 *
 * Cas EUR : taux=1, `*_final` = montant. Une devise étrangère à taux 1 ou absent
 * trahit un échec de taux antérieur : on retente la source de taux. Les lignes
 * déjà cohérentes ne déclenchent ni appel réseau ni écriture.
 *
 * @param {Object} row  ligne brute de la table `depenses` (mutée si reconvertie)
 * @returns {Promise<boolean>} vrai si la ligne a été modifiée en base
 */
async function reconvertirDepense(row) {
  const devise = row.devise || 'EUR';
  const stored = parseFloat(row.taux_devise);
  const suspect =
    devise !== 'EUR' && (!Number.isFinite(stored) || stored <= 0 || stored === 1);

  const taux = suspect
    ? await tauxVersEur(devise, row.date_depense)
    : (Number.isFinite(stored) && stored > 0 ? stored : 1);

  const attendu = {
    taux_devise: String(taux),
    ht_final: toEur(row.ht, taux),
    tva_final: toEur(row.tva, taux),
    ttc_final: toEur(row.ttc, taux),
  };

  // Inchangé si taux et `*_final` déjà cohérents. Tolérance sous le millième
  // d'euro (très en deçà du centime) pour ignorer les écarts de représentation
  // flottante PHP/JS sur les lignes déjà converties par Sogest — évite de les
  // réécrire inutilement à chaque lecture.
  const num = (v) => parseFloat(v) || 0;
  const proche = (a, b) => Math.abs(num(a) - num(b)) < 1e-4;
  const inchange =
    Number.isFinite(stored) && Math.abs(stored - taux) < 1e-9 &&
    proche(row.ht_final, attendu.ht_final) &&
    proche(row.tva_final, attendu.tva_final) &&
    proche(row.ttc_final, attendu.ttc_final);
  if (inchange) return false;

  await db('depenses').where('id', row.id).update(attendu);
  Object.assign(row, attendu);
  return true;
}

function formatNdf(row) {
  if (!row) return null;
  if (typeof row.timeline === 'string') {
    try { row.timeline = JSON.parse(row.timeline || '[]'); } catch { row.timeline = []; }
  } else if (row.timeline == null) {
    row.timeline = [];
  }
  row.avances = row.avances ? String(row.avances).split(',').filter(Boolean).map(Number) : [];
  return row;
}

function formatDepense(row) {
  if (!row) return null;
  let meta = {};
  if (row.meta) { try { meta = JSON.parse(row.meta); } catch { meta = {}; } }
  row.immatriculation = meta.immatriculation ?? null;
  row.type_vehicule = meta.type_vehicule ?? null;
  row.meta = meta;
  if (typeof row.pages === 'string') {
    try { row.pages = row.pages ? JSON.parse(row.pages) : []; } catch { row.pages = []; }
  }
  return row;
}

function buildMeta(existing, data) {
  const meta = { ...existing };
  if (data.immatriculation !== undefined) meta.immatriculation = data.immatriculation;
  if (data.type_vehicule !== undefined) meta.type_vehicule = data.type_vehicule;
  return meta;
}

/**
 * Résout le libellé `projet` à partir de `projet_id`/`activite_id` selon le
 * `projet_type`, et neutralise l'identifiant non pertinent (cf. trt/ndf.php).
 * @param {Object} data
 * @returns {Promise<Object>} sous-ensemble de champs ndf à appliquer
 */
async function resolveProjetData(data) {
  const out = {};
  const type = data.projet_type != null ? Number(data.projet_type) : null;

  if (type === NDF_PROJET_TYPE.PROJET) {
    out.activite_id = null;
    if (data.projet_id) {
      const p = await db('projets').select('libelle').where('id', data.projet_id).where('trash', '<>', 1).first();
      if (p) out.projet = p.libelle;
    }
  } else if (type === NDF_PROJET_TYPE.ACTIVITE) {
    out.projet_id = null;
    if (data.activite_id) {
      const a = await db('activites').select('libelle').where('id', data.activite_id).where('trash', '<>', 1).first();
      if (a) out.projet = a.libelle;
    }
  } else if (type === NDF_PROJET_TYPE.LIBRE) {
    out.projet_id = null;
    out.activite_id = null;
  }
  return out;
}

/**
 * Vrai si la saisie de la ndf est encore modifiable (brouillon / a-corriger).
 * @param {Object} ndf
 * @returns {boolean}
 */
export function ndfEstEditable(ndf) {
  return ETATS_EDITABLES.has(ndf?.etat);
}

/**
 * Vrai si la ndf est rattachée à l'utilisateur (par user_id ou par personne_id).
 * @param {Object} ndf
 * @param {{id: number, personne_id?: number}} user
 * @returns {boolean}
 */
export function ndfAppartientA(ndf, user) {
  if (!ndf || !user) return false;
  if (ndf.user_id && ndf.user_id === user.id) return true;
  if (ndf.personne_id && user.personne_id && ndf.personne_id === user.personne_id) return true;
  return false;
}

/**
 * Liste filtrée et triée des notes de frais.
 * @param {{userId?: number, personneId?: number, etat?: string, cb?: boolean, sort?: string, order?: 'asc'|'desc'}} [options]
 * @returns {Promise<Object[]>}
 */
export async function listNdf({
  userId = null,
  personneId = null,
  etat = null,
  cb = null,
  search = null,
  sort = 'modification',
  order = 'desc',
} = {}) {
  const query = db('ndf').select('*').where('trash', '<>', 1);

  // Périmètre : ndf de l'utilisateur connecté (par user_id OU sa personne_id).
  if (userId !== null || personneId !== null) {
    query.where(function () {
      if (userId !== null) this.orWhere('user_id', userId);
      if (personneId !== null) this.orWhere('personne_id', personneId);
    });
  }

  if (etat) query.where('etat', etat);
  if (cb !== null) query.where('cb', cb ? 1 : 0);

  // Recherche plein-texte (LIKE) sur les champs de la ndf ET de ses dépenses.
  // Insensible casse + accents via la collation par défaut (*_ci) de la base.
  if (search && String(search).trim()) {
    const esc = String(search).trim().replace(/[\\%_]/g, '\\$&');
    const term = `%${esc}%`;
    query.where(function () {
      this.where('projet', 'like', term)
        .orWhere('support', 'like', term)
        .orWhere('periode', 'like', term)
        .orWhere('devises', 'like', term)
        .orWhere('nom_cb', 'like', term)
        .orWhere('remarque', 'like', term)
        .orWhere('personne', 'like', term)
        .orWhere('etat', 'like', term)
        .orWhere('ttc', 'like', term)
        // ... ou l'une de ses dépenses (hors corbeille) correspond.
        .orWhereIn('id', function () {
          this.select('ndf_id')
            .from('depenses')
            .where('trash', '<>', 1)
            .andWhere(function () {
              this.where('libelle', 'like', term)
                .orWhere('etablissement', 'like', term)
                .orWhere('type_depense', 'like', term)
                .orWhere('devise', 'like', term)
                .orWhere('meta', 'like', term)
                .orWhere('ttc', 'like', term);
            });
        });
    });
  }

  const column = SORTABLE_NDF.has(String(sort)) ? sort : 'modification';
  const direction = String(order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return (await query.orderBy(column, direction)).map(formatNdf);
}

/**
 * Compte les notes de frais de l'utilisateur, groupées par état (hors corbeille).
 * @param {{userId?: number, personneId?: number}} [options]
 * @returns {Promise<{counts: Object<string, number>, total: number}>}
 */
export async function countNdfByEtat({ userId = null, personneId = null } = {}) {
  const query = db('ndf').select('etat').count({ n: '*' }).where('trash', '<>', 1);

  if (userId !== null || personneId !== null) {
    query.where(function () {
      if (userId !== null) this.orWhere('user_id', userId);
      if (personneId !== null) this.orWhere('personne_id', personneId);
    });
  }

  const rows = await query.groupBy('etat');

  const counts = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    counts[r.etat] = n;
    total += n;
  }
  return { counts, total };
}

/**
 * Récupère une note de frais par son id (hors corbeille).
 * @param {number} id
 * @param {{withDepenses?: boolean}} [options]
 * @returns {Promise<Object|null>}
 */
export async function getNdf(id, { withDepenses = false } = {}) {
  if (isNaN(id)) throw new Error('Invalid ndf ID');
  // Charger les dépenses d'abord : leur lecture peut reconvertir les montants en
  // EUR (taux à date) et recalculer les totaux dénormalisés, qu'on relit ensuite.
  const depenses = withDepenses ? await getDepenses(id) : null;
  const ndf = formatNdf(await db('ndf').where('id', id).where('trash', '<>', 1).first() ?? null);
  if (ndf && depenses) ndf.depenses = depenses;
  return ndf;
}

/**
 * Liste des dépenses d'une note de frais (hors corbeille).
 * @param {number} ndfId
 * @returns {Promise<Object[]>}
 */
export async function getDepenses(ndfId) {
  if (isNaN(ndfId)) throw new Error('Invalid ndf ID');
  const rows = await db('depenses')
    .where('ndf_id', ndfId)
    .where('trash', '<>', 1)
    .orderBy([
      { column: 'type_depense', order: 'desc' },
      { column: 'ordre', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);

  // Reconversion à l'affichage (cf. Sogest) : remet les `*_final` en EUR pour
  // les lignes non/mal converties, puis rafraîchit les totaux de la ndf.
  let modifie = false;
  for (const row of rows) {
    if (await reconvertirDepense(row)) modifie = true;
  }
  if (modifie) await recomputeNdf(ndfId);

  return rows.map(formatDepense);
}

/**
 * Récupère une dépense par son id.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export async function getDepense(id) {
  if (isNaN(id)) throw new Error('Invalid depense ID');
  return formatDepense(await db('depenses').where('id', id).where('trash', '<>', 1).first() ?? null);
}

/**
 * Crée une note de frais (état brouillon) rattachée à l'utilisateur.
 * @param {{user: Object, data?: Object}} params
 * @returns {Promise<Object>}
 */
export async function createNdf({ user, data = {} }) {
  const personneId = user.personne_id || 0;
  const personne = personneId ? await getPersonne({ personne_id: personneId }) : null;
  const support = data.support_id ? await getSupport(data.support_id) : null;

  const insert = {
    user_id: user.id,
    personne_id: personneId,
    personne: personne ? `${personne.prenom ?? ''} ${personne.nom ?? ''}`.trim() : '',
    support_id: data.support_id || 0,
    support: support ? support.nom : '',
    cb: data.cb ? 1 : 0,
    nom_cb: data.nom_cb || '',
    periode: data.periode || dayjs().format('YYYY-MM'),
    devise: data.devise || 'EUR',
    remarque: data.remarque || '',
    projet: data.projet || '',
    projet_id: data.projet_id || null,
    projet_type: data.projet_type != null ? Number(data.projet_type) : null,
    activite_id: data.activite_id || null,
    etat: 'brouillon',
    timeline: JSON.stringify([]),
  };
  Object.assign(insert, await resolveProjetData(data));

  const [id] = await db('ndf').insert(insert);
  return await getNdf(id);
}

/**
 * Met à jour une note de frais (champs whitelistés). Un changement d'`etat`
 * empile un événement dans la timeline.
 * @param {number} id
 * @param {Object} data
 * @param {Object} [user]
 * @returns {Promise<Object|null>}
 */
export async function updateNdf(id, data, user) {
  if (isNaN(id)) throw new Error('Invalid ndf ID');
  const current = await getNdf(id);
  if (!current) return null;

  const update = {};
  for (const f of EDITABLE_NDF) {
    if (data[f] !== undefined) update[f] = data[f];
  }
  if (data.cb !== undefined) update.cb = data.cb ? 1 : 0;

  if (data.support_id !== undefined) {
    const support = data.support_id ? await getSupport(data.support_id) : null;
    update.support = support ? support.nom : '';
  }

  if (data.projet_type !== undefined || data.projet_id !== undefined || data.activite_id !== undefined) {
    Object.assign(update, await resolveProjetData({ ...current, ...data }));
  }

  if (data.etat !== undefined && data.etat !== current.etat) {
    if (!NDF_ETATS.includes(data.etat)) throw new Error('Invalid etat');
    const timeline = Array.isArray(current.timeline) ? current.timeline : [];
    timeline.push({
      etat: data.etat,
      precedent: current.etat,
      datetime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      message: data.etat === 'a-corriger' ? (data.remarque ?? current.remarque ?? '') : '',
      user: user?.id ?? null,
      username: user?.nomComplet ?? null,
    });
    update.etat = data.etat;
    update.timeline = JSON.stringify(timeline);
  }

  if (Object.keys(update).length === 0) return current;
  await db('ndf').where('id', id).update(update);
  return await getNdf(id);
}

/**
 * Suppression logique d'une note de frais (et de ses dépenses).
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteNdf(id) {
  if (isNaN(id)) throw new Error('Invalid ndf ID');
  await db('depenses').where('ndf_id', id).update({ trash: 1 });
  return (await db('ndf').where('id', id).update({ trash: 1 })) > 0;
}

/**
 * Ajoute une dépense à une note de frais et recalcule les totaux.
 * Les montants sont saisis dans la devise de la dépense ; `*_final` stocke leur
 * conversion en EUR (devise de référence) au taux de la date, et `taux_devise`
 * le taux appliqué. Les totaux de la ndf sont calculés sur les `*_final`.
 * @param {Object} ndf
 * @param {Object} [data]
 * @returns {Promise<Object>}
 */
export async function createDepense(ndf, data = {}) {
  const ht = money(data.ht);
  const tva = money(data.tva);
  const ttc = money(data.ttc);

  const devise = data.devise || ndf.devise || 'EUR';
  const date_depense = data.date_depense || (ndf.periode ? `${ndf.periode}-01` : '');
  // Conversion en EUR (devise de référence) : ce sont les *_final qui servent
  // au calcul des totaux de la ndf.
  const taux = await tauxVersEur(devise, date_depense);

  const insert = {
    ndf_id: ndf.id,
    support_id: data.support_id || ndf.support_id || 0,
    support: '',
    projet: data.projet ?? ndf.projet ?? '',
    type_depense: data.type_depense || '',
    date_depense,
    libelle: data.libelle || '',
    etablissement: data.etablissement || '',
    justificatif: data.justificatif || '',
    devise,
    taux_devise: String(taux),
    ht, tva, ttc,
    ht_final: toEur(ht, taux), tva_final: toEur(tva, taux), ttc_final: toEur(ttc, taux),
    pages: '',
    meta: JSON.stringify(buildMeta({}, data)),
    ordre: data.ordre != null ? Number(data.ordre) : 9999,
  };

  const [id] = await db('depenses').insert(insert);
  await recomputeNdf(ndf.id);
  return await getDepense(id);
}

/**
 * Met à jour une dépense (champs whitelistés) puis recalcule la ndf parente.
 * @param {number} id
 * @param {Object} [data]
 * @returns {Promise<Object|null>}
 */
export async function updateDepense(id, data = {}) {
  if (isNaN(id)) throw new Error('Invalid depense ID');
  const current = await db('depenses').where('id', id).where('trash', '<>', 1).first();
  if (!current) return null;

  const update = {};
  for (const f of EDITABLE_DEPENSE) {
    if (data[f] !== undefined) update[f] = data[f];
  }
  if (data.ht !== undefined) update.ht = money(data.ht);
  if (data.tva !== undefined) update.tva = money(data.tva);
  if (data.ttc !== undefined) update.ttc = money(data.ttc);

  // Recalcule les montants convertis en EUR (*_final) + le taux dès qu'un
  // facteur change : devise, date de la dépense, ou un des montants saisis.
  const reconvertir = ['devise', 'date_depense', 'ht', 'tva', 'ttc'].some(
    (f) => data[f] !== undefined,
  );
  if (reconvertir) {
    const devise = update.devise ?? current.devise;
    const date = update.date_depense ?? current.date_depense;
    const taux = await tauxVersEur(devise, date);
    update.taux_devise = String(taux);
    update.ht_final = toEur(update.ht ?? current.ht, taux);
    update.tva_final = toEur(update.tva ?? current.tva, taux);
    update.ttc_final = toEur(update.ttc ?? current.ttc, taux);
  }

  if (data.immatriculation !== undefined || data.type_vehicule !== undefined) {
    let meta = {};
    if (current.meta) { try { meta = JSON.parse(current.meta); } catch { meta = {}; } }
    update.meta = JSON.stringify(buildMeta(meta, data));
  }

  if (Object.keys(update).length === 0) return formatDepense(current);
  await db('depenses').where('id', id).update(update);
  if (current.ndf_id) await recomputeNdf(current.ndf_id);
  return await getDepense(id);
}

/**
 * Suppression logique d'une dépense puis recalcul de la ndf parente.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteDepense(id) {
  if (isNaN(id)) throw new Error('Invalid depense ID');
  const current = await db('depenses').where('id', id).where('trash', '<>', 1).first();
  if (!current) return false;
  const ok = (await db('depenses').where('id', id).update({ trash: 1 })) > 0;
  if (current.ndf_id) await recomputeNdf(current.ndf_id);
  return ok;
}

/**
 * Recalcule les champs dénormalisés d'une note de frais à partir de ses
 * dépenses : totaux HT/TVA/TTC, nombre de lignes et CSV des devises.
 * @param {number} ndfId
 * @returns {Promise<void>}
 */
export async function recomputeNdf(ndfId) {
  const rows = await db('depenses')
    .where('ndf_id', ndfId)
    .where('trash', '<>', 1)
    .select('ht_final', 'tva_final', 'ttc_final', 'devise');

  const totals = { ht: 0, tva: 0, ttc: 0 };
  const devises = new Set();
  for (const r of rows) {
    totals.ht += parseFloat(r.ht_final) || 0;
    totals.tva += parseFloat(r.tva_final) || 0;
    totals.ttc += parseFloat(r.ttc_final) || 0;
    if (r.devise) devises.add(r.devise);
  }

  await db('ndf').where('id', ndfId).update({
    ht: totals.ht.toFixed(2),
    tva: totals.tva.toFixed(2),
    ttc: totals.ttc.toFixed(2),
    lignes: rows.length,
    devises: [...devises].sort().join(','),
  });
}
