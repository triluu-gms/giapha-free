'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultLayout, type LayoutOptions } from '@/lib/treeLayout';

/** Phones get their own layout choice (left to right by default); tablets and PCs share one (compact). */
const PHONE_QUERY = '(max-width: 767px)';
const storageKey = (screen: Screen) => `familyTree.layout.${screen}`;
type Screen = 'phone' | 'wide';

function read(screen: Screen): LayoutOptions | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(screen)) ?? 'null');
    const ok =
      value &&
      (value.direction === 'down' || value.direction === 'right') &&
      typeof value.couplesStacked === 'boolean' &&
      typeof value.stackSiblings === 'boolean' &&
      typeof value.wrapChi === 'boolean';
    return ok ? value : undefined;
  } catch {
    return undefined; // storage unavailable or an old value: use the default
  }
}

/** The tree layout options for this kind of screen, remembered on this device. */
export function useLayoutPrefs() {
  const [phone, setPhone] = useState(false);
  const [saved, setSaved] = useState<Partial<Record<Screen, LayoutOptions>>>({});

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    setSaved({ phone: read('phone'), wide: read('wide') });
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const screen: Screen = phone ? 'phone' : 'wide';
  const custom = saved[screen];
  const options = useMemo(() => custom ?? defaultLayout(phone), [custom, phone]);

  const setOptions = useCallback(
    (next: LayoutOptions) => {
      setSaved((s) => ({ ...s, [screen]: next }));
      try {
        window.localStorage.setItem(storageKey(screen), JSON.stringify(next));
      } catch {
        // not remembered; it still applies for now
      }
    },
    [screen],
  );

  const reset = useCallback(() => {
    setSaved((s) => ({ ...s, [screen]: undefined }));
    try {
      window.localStorage.removeItem(storageKey(screen));
    } catch {
      // ignore
    }
  }, [screen]);

  return { options, setOptions, reset, isDefault: !custom, phone };
}
