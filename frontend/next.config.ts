import type { NextConfig } from 'next';

// The browser only ever talks to this app; /api/* is proxied to the backend.
// Keeping the API same-origin makes the HttpOnly session cookie first-party.
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const dev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy. Scripts, styles, data and frames come only from this site.
 * - Next.js's own bootstrap scripts are inline, hence 'unsafe-inline' for scripts
 *   (and 'unsafe-eval' in development only, for hot reloading).
 * - Images: this site, photo links (https), Google/GitHub avatars, and data:/blob:
 *   for the photo editor and the PNG/PDF export.
 * - connect-src allows https: because the export fetches the photos it embeds.
 * - frame-ancestors 'none': no other site may show these pages in a frame (clickjacking).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https: data: blob:${dev ? ' ws: http://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // For browsers that don't support frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Pages carry one-time tokens in their address (reset, verify, invite, join links):
  // never send the address to another site, not even its path.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // The camera is used only through the photo picker on this site; no microphone or location.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
