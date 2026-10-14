import { HttpError } from '../errors';

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
