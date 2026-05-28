import dayjs from 'dayjs';
import { sogestUrl } from './sogest.js';
import { slugify } from './utils.js';

// Sources externes (cf. include/auto/devises.inc.php de sogest) :
// - liste des devises : devises.json servi par le site sogest
// - drapeaux (emoji) : dataset opencollective sur GitHub
// - taux de change : API monnaies de utils.sopress.dev
const FLAGS_URL = 'https://raw.githubusercontent.com/opencollective/country-currency-emoji-flags/refs/heads/main/currency-data.json';
const RATE_URL = 'https://utils.sopress.dev/monnaies/rate';

let rawListCache = null;     // liste brute [{ pays, monnaie, code }]
let flagsCache = null;       // map code -> emoji
const rateCache = new Map(); // 'CODE|YYYY-MM-DD' -> number (succès uniquement)

async function fetchJson(url, timeoutMs = 6000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

async function getRawList() {
  if (!rawListCache) {
    const list = await fetchJson(sogestUrl('devises.json'), 8000);
    rawListCache = Array.isArray(list) ? list : [];
  }
  return rawListCache;
}

async function getFlags() {
  if (!flagsCache) {
    // En cas d'échec : pas de mise en cache (on retentera), drapeaux par défaut.
    flagsCache = await fetchJson(FLAGS_URL, 8000);
  }
  return flagsCache;
}

function deviseName(d) {
  if (d.name) return d.name;
  return `${d.drapeau} ${d.monnaie} (${d.pays})`;
}

/**
 * Liste complète des devises, enrichies (drapeau, name, slug).
 * @returns {Promise<Object[]>}
 */
export async function getAllDevises() {
  const [list, flags] = await Promise.all([
    getRawList(),
    getFlags().catch(() => ({})),
  ]);

  return list.map((d) => {
    const out = { ...d, drapeau: flags[d.code] || '🗺️' };
    out.name = deviseName(out);
    out.slug = slugify(d.pays, d.monnaie, d.code);
    return out;
  });
}

/**
 * Récupère une devise par son code (insensible casse) ou son slug.
 * @param {string} codeOrSlug
 * @returns {Promise<Object|null>}
 */
export async function getDevise(codeOrSlug) {
  const key = String(codeOrSlug);
  const upper = key.toUpperCase();
  const lower = key.toLowerCase();
  const devises = await getAllDevises();
  return devises.find((d) => d.code === upper || d.slug === lower) ?? null;
}

/**
 * Taux de change d'une devise à une date donnée (source externe).
 *
 * Sémantique alignée sur Sogest (`getTauxDevise`) : `EUR` renvoie 1, et pour les
 * autres devises on renvoie l'inverse du taux devise→EUR (donc EUR→devise), de
 * sorte que `montant_eur = montant_devise / taux`.
 *
 * @param {string} code
 * @param {string|Date} date
 * @returns {Promise<number|null>} taux, ou null si indisponible / date invalide
 */
export async function getTauxDevise(code, date) {
  const devise = String(code || '').toUpperCase();
  if (devise === 'EUR') return 1;

  const d = dayjs(date);
  if (!d.isValid()) return null;
  const formatted = d.format('YYYY-MM-DD');

  const key = `${devise}|${formatted}`;
  if (rateCache.has(key)) return rateCache.get(key);

  try {
    const data = await fetchJson(
      `${RATE_URL}?from=${encodeURIComponent(devise)}&date=${encodeURIComponent(formatted)}`,
      6000,
    );
    const rate = data?.rate;
    if (!rate) return null; // pas de taux : on ne met pas en cache
    const taux = 1 / Number(rate);
    rateCache.set(key, taux);
    return taux;
  } catch {
    return null; // échec transitoire : pas de mise en cache
  }
}
