/**
 * @namespace Response
 */
// inc/handleResponse.js

/**
 * Wrapper générique pour gérer les réponses et erreurs.
 *
 * @param {Function} handler - Fonction asynchrone exécutant la logique
 * @returns {Function} Middleware Express
 */
export function handleResponse(handler) {
  return async (req, res, next) => {
    try {
      const result = await handler(req, res);

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
        const start = (page - 1) * limit;
        const paginatedItems = result.slice(start, start + limit).map(decodeMeta);

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

        res.json({
          data: paginatedItems,
          pagination
        });

      } else if (result && typeof result === 'object') {
        res.json(decodeMeta(result));

      } else {
        res.json(result);
      }

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' , message : ''+err});
    }
  };
}

