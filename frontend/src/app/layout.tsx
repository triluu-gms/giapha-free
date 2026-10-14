import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import Header from '@/components/Header';
import { I18nProvider } from '@/components/I18nProvider';
import { TreeProvider } from '@/components/TreeProvider';
import { LOCALE_COOKIE, negotiateLocale, translate } from '@/lib/i18n';
import './globals.css';

// The language comes from the `lang` cookie (or the browser's Accept-Language
// on a first visit), so pages render in the right language without a flash.
async function currentLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return negotiateLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: translate(locale, 'meta.title'), description: translate(locale, 'meta.description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          <AuthProvider>
            <TreeProvider>
              <Header />
              <main>{children}</main>
            </TreeProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
