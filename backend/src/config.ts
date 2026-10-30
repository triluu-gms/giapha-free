import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export const config = {
  neo4j: {
    uri: process.env.NEO4J_URI ?? '',
    username: process.env.NEO4J_USERNAME ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? '',
    database: process.env.NEO4J_DATABASE || undefined,
  },
  port: Number(process.env.PORT ?? 4000),
  // Which proxies to trust for the client's IP (see trustProxy in app.ts). Empty: Vercel, or this machine only.
  trustProxy: process.env.TRUST_PROXY ?? '',
  // Vercel Cron sends it as "Authorization: Bearer <CRON_SECRET>". Empty disables the keep-alive endpoint.
  cronSecret: process.env.CRON_SECRET ?? '',
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    // Public URL of the frontend, which proxies /api/* to this backend so the
    // session cookie is first-party. OAuth callbacks are built from it.
    publicAppUrl: trimSlash(process.env.PUBLIC_APP_URL || 'http://localhost:3000'),
  },
  // Verified accounts with these emails (comma-separated) can connect the Gmail account
  // emails are sent from. Empty: nobody, as there is no admin by default.
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  email: {
    // 'resend' (default) or 'gmail': one Gmail account through the Gmail API (email/gmail.ts).
    provider: ((process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase() === 'gmail' ? 'gmail' : 'resend') as
      | 'resend'
      | 'gmail',
    // https://resend.com — when empty, emails are printed to the console instead.
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM || 'Family Tree <onboarding@resend.dev>',
    gmail: {
      // An admin connects the sending account through the Google sign-in OAuth client
      // (see email/gmail.ts). When set, it must be this address.
      sender: (process.env.GMAIL_SENDER ?? '').trim().toLowerCase(),
      // Instead of connecting: a refresh token of GMAIL_SENDER with the gmail.send scope.
      refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? '',
    },
  },
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    },
  },
  // Where uploaded person photos are kept. Empty disables uploads (photo URLs still work).
  photos: {
    storage: (process.env.PHOTO_STORAGE ?? '').trim().toLowerCase(),
    s3: {
      // Empty means AWS S3 itself; set it for R2, MinIO, Backblaze B2, Wasabi…
      endpoint: trimSlash(process.env.S3_ENDPOINT ?? ''),
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      // Defaults to path-style (endpoint/bucket/key) with a custom endpoint, virtual-hosted on AWS.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE
        ? process.env.S3_FORCE_PATH_STYLE === 'true'
        : Boolean(process.env.S3_ENDPOINT),
      prefix: process.env.S3_PREFIX ?? 'photos/',
    },
    gdrive: {
      folderId: process.env.GDRIVE_FOLDER_ID ?? '',
      // Either a service account (its JSON key, raw or base64) with access to a shared drive folder…
      serviceAccountJson: process.env.GDRIVE_SERVICE_ACCOUNT_JSON ?? '',
      // …or a user's OAuth refresh token. The client defaults to the Google sign-in client.
      clientId: process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
      refreshToken: process.env.GDRIVE_REFRESH_TOKEN ?? '',
    },
  },
};
