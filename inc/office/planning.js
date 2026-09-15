import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { CRENEAUX, JOURS, heuresDebutFin, lundiDeLaSemaine } from './endroits.js';
import { listReservations } from './reservations.js';

dayjs.extend(isoWeek);

/**
 * Planning hebdomadaire d'un endroit : la grille (jours, heures, créneaux), la
 * navigation de semaine en semaine, et les réservations de la période.
 *
 * C'est le pendant des champs `date` / `heures` / `jours` / `creneaux` /
 * `reservations` que la route legacy `endroits` collait sur chaque endroit ;
 * ici la grille est calculée une fois, pour l'endroit demandé.
 *
 * @param {Object} endroit
 * @param {{semaine?: number, annee?: number}} [options]
 * @returns {Promise<Object>}
 */
export async function planningEndroit(endroit, { semaine = null, annee = null } = {}) {
  const aujourdhui = dayjs();
  const semaineDemandee = semaine || aujourdhui.isoWeek();
  const lundi = lundiDeLaSemaine(semaineDemandee, annee);

  const jours = JOURS.map((jour, index) => {
    const date = dayjs(lundi).add(index, 'day');
    return {
      slug: jour.slug,
      nom: jour.nom,
      date: date.format('YYYY-MM-DD'),
      libelle: date.format('DD/MM/YYYY'),
      aujourdhui: date.isSame(aujourdhui, 'day'),
    };
  });

  const reservations = await listReservations({
    endroitId: endroit.id,
    from: jours[0].date,
    to: jours[jours.length - 1].date,
  });

  return {
    endroit_id: endroit.id,
    ferme: endroit.ferme,
    message_ferme: endroit.ferme ? endroit.message_ferme : '',
    semaine: {
      numero: dayjs(lundi).isoWeek(),
      annee: dayjs(lundi).year(),
      lundi,
      precedente: dayjs(lundi).subtract(1, 'week').isoWeek(),
      suivante: dayjs(lundi).add(1, 'week').isoWeek(),
      courante: dayjs(lundi).isSame(aujourdhui, 'isoWeek'),
    },
    maintenant: {
      date: aujourdhui.format('YYYY-MM-DD'),
      heure: aujourdhui.format('HH:mm'),
    },
    jours,
    heures: heuresDebutFin(),
    creneaux: CRENEAUX,
    reservations,
  };
}
