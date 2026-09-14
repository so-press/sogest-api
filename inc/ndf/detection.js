/**
 * Détection, par l'API « ask », des données d'une dépense à partir de son
 * justificatif. Reprend la détection IA de sogest (include/auto/ndf.inc.php :
 * promptsDetectionJustif, detecterChampJustif, detecterMontantsJustif) et ses
 * deux règles structurantes :
 *
 * 1. **Le modèle ne fait que lire.** Le montant de TVA ne lui est jamais
 *    demandé : il est calculé ici à partir de ce qui est réellement imprimé
 *    sur le justificatif (HT + TTC, ou l'un des deux avec le taux).
 * 2. **Un PDF est converti en image** avant d'être soumis : c'est la première
 *    page qui est lue.
 *
 * Là où sogest fait un appel par champ, les six champs sont ici lus en **une
 * seule requête**. Mesuré sur douze justificatifs réels (images et PDF), à
 * montants identiques : même latence — les appels unitaires étant parallèles,
 * elle est celle du plus lent — pour quatre fois moins de requêtes au service.
 * Le prompt est explicite sur ce qu'est la « nature » d'une dépense et sur la
 * déduction de la devise depuis le symbole monétaire : sans ces deux
 * précisions, la lecture groupée rendait des natures inexploitables (« course »,
 * « SP95E10 ») et manquait des devises.
 */

import { ask, askJson } from '../core/ask.js';
import { pdfEnImages } from '../core/pdf.js';
import { getAllDevises } from './devises.js';

/**
 * Les deux prompts. `tout` porte, fondues en une seule demande, les consignes
 * des prompts unitaires de sogest (promptsDetectionJustif) ; `taux_tva` est le
 * sien, mot pour mot, pour la seconde lecture de rattrapage.
 */
const PROMPTS = {
  tout:
    'Lis ce justificatif de dépense et renvoie ce que tu y trouves :\n'
    + '- "nature" : la nature de la dépense, c\'est à dire la raison pour laquelle elle a été faite, en quelques mots — par exemple "Repas au restaurant", "Achat de carburant", "Course en taxi", "Nuit d\'hôtel". Ce n\'est ni le nom du vendeur, ni la référence d\'un article imprimée sur le ticket ;\n'
    + '- "etablissement" : le nom de l\'établissement/site internet/prestataire/vendeur auprès de qui elle a eu lieu ;\n'
    + '- "devise" : le code ISO 4217 à trois lettres de la devise dans laquelle elle a été payée, au besoin déduit du symbole monétaire imprimé en regard des montants (€ = EUR, $ = USD, £ = GBP) ;\n'
    + '- "ht" : le montant total hors taxes ;\n'
    + '- "ttc" : le montant total toutes taxes comprises, c\'est à dire la somme réellement payée ;\n'
    + '- "taux_tva" : le taux de TVA appliqué, en pourcentage.\n'
    + 'Pour ht, ttc et taux_tva, relève uniquement ce qui est explicitement imprimé sur le document : ne calcule rien et ne devine rien, mets null pour toute valeur qui n\'est pas lisible telle quelle. Si plusieurs taux de TVA apparaissent, mets null pour taux_tva. Si le document indique explicitement une absence de TVA (par exemple "TVA non applicable"), mets 0 pour taux_tva. Les nombres s\'écrivent avec un point décimal, sans symbole monétaire ni séparateur de milliers.\n'
    + 'Réponds uniquement par un objet JSON de la forme {"nature":"...","etablissement":"...","devise":"EUR","ht":123.45,"ttc":148.14,"taux_tva":20}, avec null pour tout champ que tu ne peux pas déterminer.',
  taux_tva:
    'Quel est le taux de TVA appliqué à la dépense décrite par ce justificatif ? Réponds uniquement par le pourcentage sous forme de nombre, par exemple 20 ou 5.5. Si le justificatif ne mentionne aucune TVA, réponds 0. Si plusieurs taux différents y figurent, commence ta réponse par "ERREUR:".',
};

/**
 * Convertit en nombre une valeur lue par le modèle : symboles monétaires,
 * espaces insécables, virgule décimale, séparateurs de milliers.
 * Port de `nombreDetecte()`.
 * @param {*} valeur
 * @returns {number|null} `null` si ce n'est pas un nombre
 */
function nombreDetecte(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;

  let nombre = String(valeur).replace(/[ \s]/g, '').replace(/[^0-9,.-]/g, '').replace(/,/g, '.');

  // Séparateurs de milliers éventuels : on ne garde que le dernier point.
  const points = nombre.split('.').length - 1;
  if (points > 1) {
    const pos = nombre.lastIndexOf('.');
    nombre = nombre.slice(0, pos).replace(/\./g, '') + nombre.slice(pos);
  }

  const n = parseFloat(nombre);
  return Number.isFinite(n) && /^-?\d*\.?\d+$/.test(nombre) ? n : null;
}

/** Montant au format de stockage des dépenses : `123.45`. */
function montantFormate(montant) {
  return (Math.round((parseFloat(montant) || 0) * 100) / 100).toFixed(2);
}

/**
 * Taux de TVA lu par le modèle, ramené en pourcentage : un taux exprimé en
 * fraction (0.2 pour 20 %) est converti, au delà de 100 % il est rejeté.
 * Port de `tauxTvaDetecte()`.
 * @param {*} valeur
 * @returns {number|null}
 */
function tauxTvaDetecte(valeur) {
  let taux = nombreDetecte(valeur);
  if (taux === null || taux < 0) return null;
  if (taux > 0 && taux < 1) taux = taux * 100;
  return taux > 100 ? null : taux;
}

/**
 * Calcule les trois montants à partir de ce que le justificatif porte
 * réellement — le calcul est fait ici, jamais par le modèle. Port de
 * `resoudreMontantsJustif()`.
 *
 * - HT et TTC connus   → TVA = TTC − HT
 * - HT et taux connus  → TVA = HT × taux, TTC = HT + TVA
 * - TTC et taux connus → HT = TTC / (1 + taux), TVA = TTC − HT
 *
 * Si un seul montant est lisible et qu'aucun taux ne permet de compléter, il
 * est renvoyé seul.
 *
 * @param {number|null} ht
 * @param {number|null} ttc
 * @param {number|null} taux
 * @returns {{ht?: string, tva?: string, ttc?: string}}
 */
function resoudreMontants(ht, ttc, taux) {
  if (ht !== null && ttc !== null) {
    const tva = ttc - ht;
    // Un TTC inférieur au HT signale une lecture incohérente : mieux vaut ne
    // rien déduire que de proposer une TVA négative.
    if (tva < 0) return {};
    return { ht: montantFormate(ht), tva: montantFormate(tva), ttc: montantFormate(ttc) };
  }
  if (ht !== null && taux !== null) {
    const tva = Math.round(ht * taux) / 100;
    return { ht: montantFormate(ht), tva: montantFormate(tva), ttc: montantFormate(ht + tva) };
  }
  if (ttc !== null && taux !== null) {
    const ht2 = Math.round((ttc / (1 + taux / 100)) * 100) / 100;
    return { ht: montantFormate(ht2), tva: montantFormate(ttc - ht2), ttc: montantFormate(ttc) };
  }
  if (ttc !== null) return { ttc: montantFormate(ttc) };
  if (ht !== null) return { ht: montantFormate(ht) };
  return {};
}

/**
 * Code devise lu par le modèle, validé contre les devises connues de
 * l'application. Port de `normaliserValeurDetectee('devise', …)`.
 * @param {string} valeur
 * @returns {Promise<string>} Code ISO 4217, ou `''`
 */
async function normaliserDevise(valeur) {
  const code = String(valeur || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (code.length !== 3) return '';

  try {
    const devises = await getAllDevises();
    return devises.some((d) => d.code === code) ? code : '';
  } catch (err) {
    // Liste des devises indisponible : on préfère ne rien proposer plutôt que
    // d'écrire un code que l'application ne saurait pas convertir.
    console.error(`normaliserDevise: ${err}`);
    return '';
  }
}

/**
 * Image à soumettre au modèle pour un justificatif : le fichier lui-même, ou
 * la première page rendue en image si c'est un PDF. Port de
 * `urlImageJustifPourIa()`.
 *
 * @param {string} justificatif URL du justificatif
 * @returns {Promise<string>} URL de l'image, ou `''`
 */
async function imageDuJustificatif(justificatif) {
  if (!justificatif) return '';

  const chemin = String(justificatif).split('?')[0];
  if (!/\.pdf$/i.test(chemin)) return justificatif;

  const pages = await pdfEnImages(justificatif);
  return pages[0] || '';
}

/**
 * Lit un justificatif et en extrait tout ce qui est inférable.
 *
 * Une seule requête suffit pour les six champs. Une seconde lecture, ciblée sur
 * le seul taux de TVA, n'a lieu que s'il manque un montant que ce taux
 * permettrait de reconstituer (rattrapage de `detecterMontantsJustif()`) : HT et
 * TTC lus tous les deux, la TVA en découle et le taux ne sert à rien.
 *
 * @param {string} justificatif URL du justificatif
 * @returns {Promise<{nature: string|null, etablissement: string|null, devise: string|null,
 *   ht: string|null, tva: string|null, ttc: string|null}>} Chaque champ vaut
 *   `null` s'il n'a pas pu être lu.
 */
export async function detecterDepuisJustificatif(justificatif) {
  const image = await imageDuJustificatif(justificatif);
  if (!image) return vide();

  const lu = await askJson(PROMPTS.tout, { image, tokens: 500 });
  if (!lu) return vide();

  const ht = nombreDetecte(lu.ht);
  const ttc = nombreDetecte(lu.ttc);
  let taux = tauxTvaDetecte(lu.taux_tva ?? lu.taux);

  if ((ht === null || ttc === null) && taux === null && (ht !== null || ttc !== null)) {
    taux = tauxTvaDetecte(await ask(PROMPTS.taux_tva, { image }));
  }

  const montants = resoudreMontants(ht, ttc, taux);

  return {
    nature: lu.nature ? String(lu.nature).trim() : null,
    etablissement: lu.etablissement ? String(lu.etablissement).trim() : null,
    devise: (await normaliserDevise(lu.devise)) || null,
    ht: montants.ht ?? null,
    tva: montants.tva ?? null,
    ttc: montants.ttc ?? null,
  };
}

/** Résultat de détection entièrement vide. */
function vide() {
  return { nature: null, etablissement: null, devise: null, ht: null, tva: null, ttc: null };
}

/** Correspondance champ détecté → colonne de `depenses`. */
const COLONNES = {
  nature: 'libelle',
  etablissement: 'etablissement',
  devise: 'devise',
  ht: 'ht',
  tva: 'tva',
  ttc: 'ttc',
};

/** Colonnes monétaires : `0.00` y est une absence de saisie, pas un montant. */
const MONTANTS = new Set(['ht', 'tva', 'ttc']);

/**
 * Un champ de la dépense est-il vide ? Pour les montants, la valeur par défaut
 * `0.00` (celle d'une ligne jamais saisie) compte comme vide.
 * @param {string} colonne
 * @param {*} valeur
 * @returns {boolean}
 */
function champVide(colonne, valeur) {
  const texte = String(valeur ?? '').trim();
  if (texte === '') return true;
  return MONTANTS.has(colonne) && (parseFloat(texte) || 0) === 0;
}

/**
 * Ne retient de la détection que ce qui comble un champ vide de la dépense :
 * une valeur saisie par l'utilisateur n'est jamais écrasée.
 *
 * @param {Object} depense Dépense courante
 * @param {Object} detecte Résultat de `detecterDepuisJustificatif()`
 * @returns {Object} Champs à écrire (clés = colonnes de `depenses`), possiblement vide
 */
export function champsAAppliquer(depense, detecte) {
  const aEcrire = {};

  for (const [champ, colonne] of Object.entries(COLONNES)) {
    const valeur = detecte[champ];
    if (valeur === null || valeur === undefined || valeur === '') continue;
    if (MONTANTS.has(colonne) && (parseFloat(valeur) || 0) === 0) continue;
    if (!champVide(colonne, depense[colonne])) continue;
    aEcrire[colonne] = valeur;
  }

  return aEcrire;
}
