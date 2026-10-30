'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The `?token=` of an emailed link (reset password, verify or confirm email, invitation),
 * read once and then removed from the address bar, so it doesn't stay in the browser's
 * history or get copied along with the address. The page keeps using it from memory.
 */
export function useLinkToken(): string | null {
  const params = useSearchParams();
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return token;
}
