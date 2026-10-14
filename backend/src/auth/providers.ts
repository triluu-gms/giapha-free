import { config } from '../config';

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  id: string;
  name: string;
  usesPkce: boolean;
  authorizationUrl(params: { state: string; redirectUri: string; codeChallenge?: string }): string;
  getProfile(params: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthProfile>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body || body.error) {
    throw new Error(`OAuth request to ${new URL(url).host} failed (${res.status}${body?.error ? `: ${body.error}` : ''})`);
  }
  return body;
}

function google(clientId: string, clientSecret: string): OAuthProvider {
  return {
    id: 'google',
    name: 'Google',
    usesPkce: true,
    authorizationUrl: ({ state, redirectUri, codeChallenge }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge ?? '',
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })}`,
    async getProfile({ code, redirectUri, codeVerifier }) {
      const token = await fetchJson<{ access_token: string }>('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier ?? '',
        }),
      });
      const info = await fetchJson<{
        sub: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      }>('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      return {
        providerAccountId: info.sub,
        email: info.email ?? null,
        emailVerified: info.email_verified === true,
        name: info.name ?? null,
        avatarUrl: info.picture ?? null,
      };
    },
  };
}

function github(clientId: string, clientSecret: string): OAuthProvider {
  return {
    id: 'github',
    name: 'GitHub',
    usesPkce: false,
    authorizationUrl: ({ state, redirectUri }) =>
      `https://github.com/login/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state,
        allow_signup: 'true',
      })}`,
    async getProfile({ code, redirectUri }) {
      const token = await fetchJson<{ access_token: string }>('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'family-tree-api',
      };
      const [user, emails] = await Promise.all([
        fetchJson<{ id: number; login: string; name: string | null; avatar_url: string | null }>(
          'https://api.github.com/user',
          { headers },
        ),
        fetchJson<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', {
          headers,
        }).catch(() => []),
      ]);
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return {
        providerAccountId: String(user.id),
        email: primary?.email ?? null,
        emailVerified: Boolean(primary),
        name: user.name || user.login,
        avatarUrl: user.avatar_url,
      };
    },
  };
}

/** Providers are enabled by setting their client id and secret. */
export function getProviders(): OAuthProvider[] {
  const { google: g, github: gh } = config.oauth;
  const providers: OAuthProvider[] = [];
  if (g.clientId && g.clientSecret) providers.push(google(g.clientId, g.clientSecret));
  if (gh.clientId && gh.clientSecret) providers.push(github(gh.clientId, gh.clientSecret));
  return providers;
}

export const getProvider = (id: string) => getProviders().find((p) => p.id === id);
