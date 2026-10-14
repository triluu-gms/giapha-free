'use client';

import { Suspense } from 'react';
import { useI18n } from '@/components/I18nProvider';
import RequireAuth from '@/components/RequireAuth';
import TreeExplorer from '@/components/TreeExplorer';
import { useTrees } from '@/components/TreeProvider';

function CurrentTree() {
  const { current } = useTrees();
  // Remount on switch so selection, focus and depth reset for the new tree.
  return <TreeExplorer key={current?.id} />;
}

export default function HomePage() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      <Suspense fallback={<div className="center muted">{t('common.loading')}</div>}>
        <CurrentTree />
      </Suspense>
    </RequireAuth>
  );
}
