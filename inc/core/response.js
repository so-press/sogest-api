/**
 * Construit une erreur HTTP « métier » : statut, code d'erreur stable
 * (renvoyé tel quel dans le champ `error`) et message lisible.
 *
 * Sans code, `handleResponse` retombe sur son comportement historique
 * (`error` = message de l'exception).
 *
 * @param {number} status Statut HTTP
 * @param {string} code Code stable, ex. `membre_existant`
 * @param {string} message Message lisible destiné à l'appelant
 * @returns {Error}
 */
export function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.errorCode = code;
  return err;
}

/**
 * Wrapper générique pour les handlers Express : la valeur renvoyée est sérialisée
 * en JSON, un tableau est paginé via `?page` / `?limit`, `?count=1` ne renvoie
 * que la pagination, et les erreurs sont attrapées et renvoyées en 500 (ou le
 * `res.status(...)` posé par le handler).
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<any>} handler
 * @returns {import('express').RequestHandler}
 */
export function handleResponse(handler) {
  return async (req, res, next) => {
    try {
      const result = await handler(req, res);

      // Le handler a déjà répondu lui-même (204 sans corps, res.json()…).
      if (res.headersSent) return;

      const decodeMeta = (item) => {
        if (item && typeof item.meta === 'string') {
          try {
            item.meta = JSON.parse(item.meta);
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
        return item;
      };
      // Handle array result with optional pagination
      if (Array.isArray(result)) {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;

        const totalPages = Math.ceil(result.length / limit);
        const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
        const query = new URLSearchParams(req.query);

        const pagination = {
          page,
          limit,
          total: result.length,
          pages: totalPages
        };
        if (page < totalPages) {
          query.set('page', page + 1);
          pagination.next = `${baseUrl}?${query.toString()}`;
        }

        if (page > 1) {
          query.set('page', page - 1);
          pagination.prev = `${baseUrl}?${query.toString()}`;
        }

        // Mode "compte seul" : ?count (count=1/true) renvoie uniquement la
        // pagination (dont `total`), sans le tableau `data`. Natif sur toutes
        // les routes liste, sans modifier leur code.
        const c = req.query.count;
        const countOnly = c !== undefined && c !== 'false' && c !== '0';

        if (countOnly) {
          res.json({ pagination });
        } else {
          const start = (page - 1) * limit;
          const paginatedItems = result.slice(start, start + limit).map(decodeMeta);
          res.json({ data: paginatedItems, pagination });
        }

      } else if (result && typeof result === 'object') {
        res.json(decodeMeta(result));

      } else {
        res.json(result);
      }

    } catch (err) {
      console.error(err);
      // Honore le statut posé par le handler (res.status(...)) ou porté par
      // l'erreur (err.status / err.statusCode) ; 500 par défaut.
      const status =
        err.status ||
        err.statusCode ||
        (res.statusCode >= 400 ? res.statusCode : 500);
      // Erreur métier (httpError) : `error` porte le code stable, `message` le
      // texte lisible. Sinon, comportement historique.
      res.status(status).json({
        error: err.errorCode || (status === 500 ? 'Server error' : (err.message || 'Error')),
        message: err.errorCode ? err.message : '' + err,
      });
    }
  };
}

