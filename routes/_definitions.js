/**
 * @apiDefine JwtHeader
 * @apiHeader {String} Authorization Token JWT au format `Bearer <token>` requis
 * @apiError (401) Unauthorized Token manquant ou invalide
 */


/**
 * @apiDefine globalToken
 * @apiHeader {String} Authorization Token d'aplication au format `Bearer <token>` requis
 * @apiError (401) Unauthorized Token manquant ou invalide
 */