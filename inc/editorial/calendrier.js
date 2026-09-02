import { listActivites, withCouvertures } from './activites.js';
import { dateParis, getLignesCalendrier, getTransco } from './mahalo.js';

/**
 * Calendrier de parution unifié : les items viennent de Mahalo (via le service
 * Mahalo Grabber), les activités de sogest. Chaque item du calendrier est
 * toujours présent, qu'une activité lui corresponde ou non.
 *
 * Le rapprochement se fait en deux passes, dans cet ordre :
 *  1. **numéro** — `activites.numero` = `noParution` de la ligne Mahalo ;
 *  2. **dates** — pour les items restés orphelins, les activités non encore
 *     rapprochées dont `date_bouclage` tombe dans l'intervalle de parution.
 *
 * Un même numéro pouvant porter plusieurs activités, `activites` est toujours
 * un tableau (vide si l'item n'est rapproché à rien).
 */

/**
 * Rapproche les lignes de calendrier d'un support avec ses activités.
 * @param {Object} support ligne `supports`
 * @param {Object[]} lignes lignes de calendrier Mahalo
 * @param {Object[]} activites activités sogest du support
 * @returns {Object[]}
 */
function rapprocher(support, lignes, activites) {
  const parNumero = new Map();
  for (const a of activites) {
    if (a.numero == null) continue;
    const cle = Number(a.numero);
    if (!parNumero.has(cle)) parNumero.set(cle, []);
    parNumero.get(cle).push(a);
  }

  // Les activités consommées par la passe « numéro » ne sont pas réutilisables
  // par la passe « dates » : sinon une même activité apparaîtrait deux fois.
  const consommees = new Set();

  const items = lignes.map((row) => {
    const numero = row.noParution ?? null;
    const trouvees = numero == null ? [] : (parNumero.get(Number(numero)) ?? []);
    for (const a of trouvees) consommees.add(a.id);

    return {
      item: {
        id: `${support.id}-${row.refCalendrier}`,
        support_id: support.id,
        support: support.nom,
        support_slug: support.slug,
        numero,
        libelle: row.libParution ?? null,
        supplement: row.libSupplement ?? null,
        code_parution: row.codeParution ?? null,
        date_debut: dateParis(row.calDu),
        date_fin: dateParis(row.calAu),
        date_validation: dateParis(row.dateValidation),
        rapprochement: trouvees.length ? 'numero' : null,
        activites: trouvees,
      },
      row,
    };
  });

  // Passe 2 : les orphelins récupèrent les activités bouclées dans leur période.
  const restantes = activites.filter((a) => !consommees.has(a.id) && a.date_bouclage);
  if (restantes.length) {
    for (const { item } of items) {
      if (item.activites.length || !item.date_debut || !item.date_fin) continue;
      const dans = restantes.filter((a) => {
        if (consommees.has(a.id)) return false;
        const d = String(a.date_bouclage).slice(0, 10);
        return d >= item.date_debut && d <= item.date_fin;
      });
      if (!dans.length) continue;
      for (const a of dans) consommees.add(a.id);
      item.activites = dans;
      item.rapprochement = 'dates';
    }
  }

  return items.map(({ item }) => item);
}

/**
 * Calendrier unifié d'une liste de supports.
 *
 * @param {Object} options
 * @param {Object[]} options.supports supports (lignes `supports`) à couvrir
 * @param {string|null} [options.du] borne basse `YYYY-MM-DD` (sur la période de parution)
 * @param {string|null} [options.au] borne haute `YYYY-MM-DD`
 * @param {boolean|null} [options.avecActivite] `true` = seulement les items rapprochés, `false` = seulement les orphelins
 * @param {'asc'|'desc'} [options.order] tri par date de début de parution
 * @param {number|null} [options.personneId] restreint les activités (utilisateur non admin)
 * @param {number|null} [options.userId] idem
 * @param {boolean} [options.couvertures] résout l'URL de couverture des activités de magazine
 * @returns {Promise<Object[]>}
 */
export async function getCalendrier({
  supports = [],
  du = null,
  au = null,
  avecActivite = null,
  order = 'desc',
  personneId = null,
  userId = null,
  couvertures = false,
} = {}) {
  if (!supports.length) return [];

  const transco = await getTransco();

  // Un support sans transco arbitrée n'a pas de calendrier : inutile d'aller
  // chercher ses activités. Les appels Mahalo sont mis en cache par le client.
  const cibles = supports.filter((s) => transco.has(Number(s.id)));

  const listes = await Promise.all(cibles.map(async (support) => {
    const lignes = await getLignesCalendrier(support.id, transco);
    if (!lignes.length) return [];

    let activites = await listActivites({
      supportId: support.id,
      sort: 'numero',
      order: 'desc',
      ...(personneId !== null || userId !== null ? { personneId: personneId ?? 0, userId: userId ?? 0 } : {}),
    });

    if (couvertures && support.type_support === 'magazine') {
      activites = await withCouvertures(activites);
    }

    return rapprocher(support, lignes, activites);
  }));

  let items = listes.flat();

  // Filtre de période : chevauchement avec l'intervalle demandé, pas inclusion.
  if (du) items = items.filter((i) => !i.date_fin || i.date_fin >= du);
  if (au) items = items.filter((i) => !i.date_debut || i.date_debut <= au);

  if (avecActivite === true) items = items.filter((i) => i.activites.length > 0);
  if (avecActivite === false) items = items.filter((i) => i.activites.length === 0);

  const sens = String(order).toLowerCase() === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const da = a.date_debut ?? '';
    const db = b.date_debut ?? '';
    if (da !== db) return da < db ? -sens : sens;
    // À date égale, ordre stable et lisible : support puis numéro.
    if (a.support_id !== b.support_id) return a.support_id - b.support_id;
    return (a.numero ?? 0) - (b.numero ?? 0);
  });

  return items;
}
