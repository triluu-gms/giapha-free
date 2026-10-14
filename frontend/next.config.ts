import type { NextConfig } from 'next';

// The browser only ever talks to this app; /api/* is proxied to the backend.
// Keeping the API same-origin makes the HttpOnly session cookie first-party.
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
