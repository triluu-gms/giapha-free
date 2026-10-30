// Adds req.user / req.tree. Referenced here (not just via tsconfig "include") because
// Vercel's builder compiles from api/index.ts and only sees files reachable from it.
/// <reference path="./types/express.d.ts" />
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import {
  requireAuthForTrees,
  requireCsrfHeader,
  requirePrivacyConsent,
  requireVerifiedEmail,
} from './auth/middleware';
import { apiRateLimit } from './auth/rateLimit';
import { config } from './config';
import { getDriver, query } from './db';
import { HttpError } from './errors';
import { runDueBackups } from './backups/backups';
import { driveConfigured } from './backups/userDrive';
import { runReminders } from './reminders/run';
import { authRouter } from './routes/auth';
import { driveRouter } from './routes/drive';
import { adminEmailRouter } from './routes/adminEmail';
import { invitationsRouter } from './routes/invitations';
import { joinRouter } from './routes/join';
import { treesRouter } from './routes/trees';

const app = express();

/**
 * Which proxies may tell us the client's address (X-Forwarded-For) and protocol. It
 * matters for security: rate limits and the login lockout count per req.ip, so trusting
 * a header the client can write would let anyone reset them with each request.
 * - On Vercel (VERCEL=1) the platform sets X-Forwarded-For itself and drops the client's.
 * - Elsewhere only a proxy on this machine is trusted unless TRUST_PROXY says otherwise:
 *   a hop count ("1"), "true"/"false", or addresses/subnets ("10.0.0.0/8, 127.0.0.1").
 */
function trustProxy(): boolean | number | string {
  const value = config.trustProxy.trim();
  if (!value) return process.env.VERCEL ? true : 'loopback';
  if (value === 'true' || value === 'false') return value === 'true';
  return /^\d+$/.test(value) ? Number(value) : value;
}
app.set('trust proxy', trustProxy());

// No CORS: browsers call the API same-origin through the frontend's /api rewrite.
// Imports carry up to 2000 people; the body is read here and the default parser skips it.
app.use('/api/trees/:treeId/import', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', requireCsrfHeader);
// Every API request is rate-limited per client IP; auth routes have tighter limits of their own.
app.use('/api', apiRateLimit);

// ---- Public routes ----
app.get('/', (_req, res) => {
  res.json({ name: 'Family Tree API', health: '/api/health' });
});

app.get('/api/health', async (_req, res) => {
  try {
    await getDriver().verifyConnectivity({ database: config.neo4j.database });
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    // The driver's message can name the database host; it goes to the server log only.
    console.error('Health check: database unreachable:', err);
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

// GET /api/features -> optional features this server has configured, so the UI can hide the rest.
app.get('/api/features', (_req, res) => {
  res.json({ photoUploads: Boolean(config.photos.storage), driveBackups: driveConfigured() });
});

/** Cron endpoints: only Vercel Cron, which sends "Authorization: Bearer <CRON_SECRET>". */
function assertCronCaller(req: Request) {
  if (!config.cronSecret) throw new HttpError(503, 'CRON_SECRET is not set');
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(digest(req.get('authorization') ?? ''), digest(`Bearer ${config.cronSecret}`))) {
    throw new HttpError(401, 'Unauthorized');
  }
}

// GET /api/cron/keepalive -> called daily by Vercel Cron (see vercel.json).
// AuraDB Free pauses an instance after a few days without writes, then deletes
// it if it stays paused, so this makes a small write every day.
// It also runs the scheduled Google Drive backups that are due: Vercel's Hobby plan
// allows only two cron jobs, and both are taken.
app.get('/api/cron/keepalive', async (req, res) => {
  assertCronCaller(req);
  const [row] = await query<{ pingedAt: string }>(
    `MERGE (k:Keepalive {id: 'aura-free'})
     SET k.pingedAt = $now, k.count = coalesce(k.count, 0) + 1
     RETURN k.pingedAt AS pingedAt`,
    { now: new Date().toISOString() },
    'WRITE',
  );
  const backups = driveConfigured() ? await runDueBackups() : null;
  res.json({ status: 'ok', pingedAt: row.pingedAt, backups });
});

// GET /api/cron/reminders -> called daily by Vercel Cron at 07:00 Vietnam time (see vercel.json).
// Emails death anniversary (ngày giỗ) reminders that are due today; safe to call again.
app.get('/api/cron/reminders', async (req, res) => {
  assertCronCaller(req);
  res.json(await runReminders());
});

app.use('/api/auth', authRouter);
// The user's own Google Drive, for tree backups; checks the session inside the router.
app.use('/api/drive', driveRouter);
// Connecting the Gmail account emails are sent from; ADMIN_EMAILS only.
app.use('/api/admin/email', adminEmailRouter);
// Preview is public; accepting/declining checks the session inside the router.
app.use('/api/invitations', invitationsRouter);
// "Request access" links: the preview is public, asking checks the session inside the router.
app.use('/api/join', joinRouter);

// ---- Protected routes: a valid session cookie, the accepted data agreement and a verified email ----
// Tree content is scoped to /api/trees/:treeId and the caller's membership of it.
app.use('/api/trees', requireAuthForTrees, requirePrivacyConsent, requireVerifiedEmail, treesRouter);
// No route lists or manages other accounts, admins (ADMIN_EMAILS) included.
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'The request is too large' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
