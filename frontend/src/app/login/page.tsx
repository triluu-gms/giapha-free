'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import ProviderIcon from '@/components/ProviderIcon';
import { useI18n } from '@/components/I18nProvider';
import { api } from '@/lib/api';
import type { AuthProviderInfo } from '@/lib/types';

type Mode = 'signin' | 'register';

function LoginForm() {
  const { status, loginWithProvider, loginWithPassword, register } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  // Arriving from an invitation: the email is prefilled and registering with it
  // joins the tree straight away (no separate verification needed).
  const inviteToken = params.get('invite') ?? undefined;

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [providers, setProviders] = useState<AuthProviderInfo[]>([]);
  // The provider being redirected to; social login leaves the page, so the buttons lock meanwhile.
  const [redirecting, setRedirecting] = useState<string | null>(null);

  // Coming back with the browser's Back button restores the page from cache, buttons still locked.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setRedirecting(null);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // Signing in from an invitation goes back to it so it can be accepted.
    router.replace(inviteToken && mode === 'signin' ? `/invite?token=${encodeURIComponent(inviteToken)}` : next);
  }, [status, next, router, inviteToken, mode]);

  useEffect(() => {
    api
      .authProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  function switchMode(to: Mode) {
    setMode(to);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await register({ name: name.trim(), email: email.trim(), password, inviteToken });
      else await loginWithPassword(email.trim(), password);
      // The status effect above redirects once signed in.
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const registering = mode === 'register';

  return (
    <div className="login-card">
      <h1>{registering ? t('login.titleRegister') : t('login.titleSignIn')}</h1>
      <p className="muted">
        {inviteToken ? t('login.hintInvite') : registering ? t('login.hintRegister') : t('login.hintSignIn')}
      </p>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={!registering} className={!registering ? 'active' : ''} onClick={() => switchMode('signin')}>
          {t('login.tabSignIn')}
        </button>
        <button role="tab" aria-selected={registering} className={registering ? 'active' : ''} onClick={() => switchMode('register')}>
          {t('login.tabRegister')}
        </button>
      </div>

      <form className="form" onSubmit={submit}>
        {registering && (
          <label>
            {t('login.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          </label>
        )}
        <label>
          {t('login.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          {t('login.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 8 : undefined}
            maxLength={128}
            required
          />
          {registering && <span className="hint">{t('login.passwordHint')}</span>}
        </label>
        {!registering && (
          <Link
            href={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
            className="small forgot-link"
          >
            {t('login.forgotPassword')}
          </Link>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t('common.pleaseWait') : registering ? t('login.submitRegister') : t('login.submitSignIn')}
        </button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="divider">
            <span>{t('login.orContinue')}</span>
          </div>
          <div className="provider-list">
            {providers.map((p) => (
              <button
                key={p.id}
                className={`btn provider provider-${p.id}`}
                onClick={() => {
                  setRedirecting(p.id);
                  loginWithProvider(p.id, inviteToken ? `/invite?token=${encodeURIComponent(inviteToken)}` : next);
                }}
                disabled={redirecting !== null}
              >
                <ProviderIcon provider={p.id} />
                <span>
                  {redirecting === p.id ? t('common.pleaseWait') : t('login.continueWith', { provider: p.name })}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="muted small">
        {registering ? (
          <>
            {t('login.haveAccount')}{' '}
            <button className="link" onClick={() => switchMode('signin')}>
              {t('login.tabSignIn')}
            </button>
          </>
        ) : (
          <>
            {t('login.newHere')}{' '}
            <button className="link" onClick={() => switchMode('register')}>
              {t('login.createAccount')}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('common.loading')}</p>;
}

export default function LoginPage() {
  return (
    <div className="center">
      <Suspense fallback={<Loading />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
