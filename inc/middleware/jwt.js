
// Middleware to ensure the token is a valid JWT
export function jwtOnlyMiddleware(req, res, next){
  if (!req.isJwt) {
    return res.status(403).json({ error: 'Unauthorized: JWT required' });
  }
  next();
};
