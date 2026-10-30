import { rateLimit, type Options } from 'express-rate-limit';
import { HttpError } from '../errors';

// ---- Request rate limits (per client IP) ----
// Every request does database work, and some hash passwords or send email, so a
// flood of requests could make the API slow or unavailable for everyone. Counters
// live in memory: on serverless hosts each warm instance counts on its own, which
// still blunts a flood from one address without adding a database write per request.

function limiter(windowMs: number, limit: number, message: string): ReturnType<typeof rateLimit> {
  const options: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // The app trusts the proxy in front of it ('trust proxy'), so req.ip is the visitor's
    // address: Vercel sets X-Forwarded-For itself and doesn't pass on a client's own value.
    validate: { trustProxy: false },
    handler: (_req, res) => {
      res.status(429).json({ error: message, code: 'rateLimited' });
    },
  };
  return rateLimit(options);
}

/** Every /api request: far above normal use, low enough to stop a flood. */
export const apiRateLimit = limiter(60 * 1000, 300, 'Too many requests. Please wait a moment and try again.');

/** Every /api/auth request (including /me, which each page load asks). */
export const authRateLimit = limiter(60 * 1000, 120, 'Too many requests. Please wait a moment and try again.');

/**
 * Sign-in, registration, password, email and account changes, and the Google/GitHub
 * sign-in start and callback: they hash passwords, send email or call the provider.
 */
// 30 leaves room for a family or office sharing one address (a Google sign-in uses two).
export const sensitiveAuthRateLimit = limiter(
  15 * 60 * 1000,
  30,
  'Too many attempts from this network. Please wait a few minutes and try again.',
);

// ---- Failed password logins (per IP and email) ----
// Best-effort brute-force protection for password login. Counters live in
// memory, so on serverless hosts they are per warm instance, not global.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; resetAt: number }>();

export function assertLoginAllowed(key: string) {
  const entry = failures.get(key);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Please wait a few minutes and try again.');
  }
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  }
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export const clearLoginFailures = (key: string) => failures.delete(key);
