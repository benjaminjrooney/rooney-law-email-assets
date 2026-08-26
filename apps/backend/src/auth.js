import { createHash, timingSafeEqual } from 'node:crypto';

/** Compare secrets in constant time regardless of length. */
export function secretsMatch(a, b) {
  if (!a || !b) return false;
  const digestA = createHash('sha256').update(String(a)).digest();
  const digestB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(digestA, digestB);
}

function presentedToken(req) {
  const header = req.get('authorization') ?? '';
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  // Fallback header for hosts that strip Authorization.
  return (req.get('x-api-token') ?? '').trim();
}

/**
 * Every API route requires the shared secret the add-in was configured with.
 * The Lob key never leaves the server, but the endpoint still spends money per
 * call, so it must not be open to the internet.
 */
export function requireApiToken(config) {
  return function apiTokenGuard(req, res, next) {
    if (!config.apiToken) {
      return res.status(503).json({
        error: { message: 'Server is missing API_TOKEN; refusing all requests.' },
      });
    }
    if (!secretsMatch(presentedToken(req), config.apiToken)) {
      return res.status(401).json({
        error: { message: 'Invalid or missing API token. Check the add-in settings.' },
      });
    }
    return next();
  };
}
