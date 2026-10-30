/**
 * Where to go after signing in, from a `?next=` parameter anyone can put in a link.
 * Only a path on this site is accepted, so a crafted link can't send the user to
 * another site (an open redirect). "/\evil.com" is the classic trick: browsers read
 * the backslash as a slash, making it "//evil.com", another site.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  // Control characters (tabs, newlines…) are dropped by URL parsing and could hide a "//".
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (typeof window === 'undefined') return raw;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
