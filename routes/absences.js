import express from 'express';
import {
  listAbsences,
  getAbsence,
  findAbsence,
  createAbsence,
  updateAbsence,
  deleteAbsence,
} from '../inc/absences.js';
import { handleResponse } from '../inc/response.js';

const router = express.Router();
// Base path for this router
export const routePath = '/absences';
// Toutes les routes nécessitent un utilisateur connecté (JWT, pas un token statique)
export const requireAuth = true;

/**
 * @api {get} /absences Liste filtrée des absences de l'utilisateur connecté
 * @apiName ListAbsences
 * @apiGroup Absences
 * @apiDescription L'utilisateur concerné est déterminé par le token JWT.
 * @apiQuery {String} [type] Filtre sur le type d'absence (ex: conge)
 * @apiQuery {String} [from] Date de début incluse (YYYY-MM-DD)
 * @apiQuery {String} [to] Date de fin incluse (YYYY-MM-DD)
 * @apiQuery {Number} [year] Filtre sur l'année
 * @apiQuery {Number} [month] Filtre sur le mois (1-12) ; nécessite `year`
 * @apiQuery {String} [sort=date] Colonne de tri (date, valeur, type, creation, id)
 * @apiQuery {String} [order=desc] Sens du tri (asc|desc)
 * @apiQuery {Number} [page] Page (pagination)
 * @apiQuery {Number} [limit=50] Nombre d'éléments par page
 * @apiUse JwtHeader
 * @apiSuccess {Object[]} data Liste paginée des absences
 */
router.get('/', handleResponse(async (req) => {
  const { type, from, to, year, month, sort, order } = req.query;
  return await listAbsences({
    userId: req.user.id,
    type: type || null,
    dateFrom: from || null,
    dateTo: to || null,
    year: year !== undefined ? parseInt(year, 10) : null,
    month: month !== undefined ? parseInt(month, 10) : null,
    sort,
    order,
  });
}));

/**
 * @api {post} /absences Pose une (ou plusieurs) absence(s)
 * @apiName CreateAbsence
 * @apiGroup Absences
 * @apiDescription L'absence est toujours rattachée à l'utilisateur du token JWT.
 * @apiBody {String} [date] Date de l'absence (YYYY-MM-DD)
 * @apiBody {String[]|Object[]} [dates] Liste de dates pour une pose multiple. Chaque
 *   élément peut être une simple chaîne `"YYYY-MM-DD"` (qui hérite des `type`/`valeur`
 *   globaux), ou un objet `{ "date": "YYYY-MM-DD", "valeur": 0.5, "type": "rtt" }`
 *   pour mélanger journées complètes et demi-journées dans une même requête.
 * @apiBody {String} [type=conge] Type d'absence (valeur par défaut pour `dates`)
 * @apiBody {Number} [valeur=1] Valeur par défaut : 1 = journée, 0.5 = demi-journée
 * @apiUse JwtHeader
 * @apiSuccess {Object} absence Absence créée (mode date unique)
 * @apiSuccess {Object[]} created Absences créées (mode dates multiples)
 * @apiError 409 Une absence existe déjà pour cet utilisateur à cette date
 */
router.post('/', handleResponse(async (req, res) => {
  const { date, dates, type = 'conge', valeur = 1 } = req.body;
  const userId = req.user.id;

  // Pose multiple : un tableau de dates (chaînes et/ou objets par date)
  if (Array.isArray(dates)) {
    const created = [];
    const skipped = [];
    for (const entry of dates) {
      // Chaîne simple → hérite des type/valeur globaux ;
      // objet → surcharge possible de date/type/valeur au cas par cas
      const item = typeof entry === 'string' ? { date: entry } : (entry || {});
      const d = item.date;
      if (!d) {
        res.status(400);
        throw new Error('Each entry in "dates" must contain a date');
      }
      if (await findAbsence(userId, d)) {
        skipped.push(d);
        continue;
      }
      created.push(await createAbsence({
        user_id: userId,
        date: d,
        type: item.type ?? type,
        valeur: item.valeur ?? valeur,
      }));
    }
    res.status(201);
    return { created, skipped };
  }

  // Pose d'une seule absence
  if (!date) {
    res.status(400);
    throw new Error('Date is required');
  }

  if (await findAbsence(userId, date)) {
    res.status(409);
    throw new Error('An absence already exists for this user on this date');
  }

  res.status(201);
  return await createAbsence({ user_id: userId, date, type, valeur });
}));

/**
 * @api {put} /absences/:id Modifie une absence
 * @apiName UpdateAbsence
 * @apiGroup Absences
 * @apiParam {Number} id Identifiant de l'absence
 * @apiBody {String} [date] Nouvelle date (YYYY-MM-DD)
 * @apiBody {String} [type] Nouveau type
 * @apiBody {Number} [valeur] Nouvelle valeur
 * @apiUse JwtHeader
 * @apiSuccess {Object} absence Absence mise à jour
 * @apiError 404 Absence introuvable
 * @apiError 403 L'absence n'appartient pas à l'utilisateur connecté
 */
router.put('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  if (existing.user_id !== req.user.id) {
    res.status(403);
    throw new Error('This absence does not belong to the current user');
  }

  await updateAbsence(id, req.body);
  return await getAbsence(id);
}));

/**
 * @api {delete} /absences/:id Supprime une absence
 * @apiName DeleteAbsence
 * @apiGroup Absences
 * @apiParam {Number} id Identifiant de l'absence
 * @apiUse JwtHeader
 * @apiSuccess {Boolean} deleted Confirmation de suppression
 * @apiError 404 Absence introuvable
 * @apiError 403 L'absence n'appartient pas à l'utilisateur connecté
 */
router.delete('/:id', handleResponse(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const existing = await getAbsence(id);
  if (!existing) {
    res.status(404);
    throw new Error('Absence not found');
  }
  if (existing.user_id !== req.user.id) {
    res.status(403);
    throw new Error('This absence does not belong to the current user');
  }

  await deleteAbsence(id);
  return { deleted: true, id };
}));

export default router;
