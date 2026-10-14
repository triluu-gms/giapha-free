'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from './I18nProvider';

/** Shows nothing while the API is healthy; only surfaces a warning when it can't be reached. */
export default function ApiStatus() {
  const { t } = useI18n();
  const [down, setDown] = useState(false);

  useEffect(() => {
    api
      .health()
      .then(() => setDown(false))
      .catch(() => setDown(true));
  }, []);

  if (!down) return null;
  return (
    <span className="api-status error" title={t('api.downTitle')}>
      <span className="dot" aria-hidden />
      <span className="api-status-label">{t('api.down')}</span>
    </span>
  );
}
