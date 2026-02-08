function extractToken(req) {
  const authHeader = req?.headers?.authorization;
  const bearerToken =
    typeof authHeader === 'string' &&
    authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  const cookieToken =
    typeof req?.cookies?.token === 'string' ? req.cookies.token.trim() : null;

  return bearerToken || cookieToken || null;
}

module.exports = {
  extractToken,
};
