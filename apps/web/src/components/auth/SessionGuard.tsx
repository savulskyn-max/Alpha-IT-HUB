'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { InactivityModal } from './InactivityModal';
import { useInactivityTimer } from './useInactivityTimer';

const BC_CHANNEL = 'alpha_session';

interface SessionGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side guard that:
 *  1. Watches the Supabase session state.
 *  2. Tracks user inactivity (30-minute timeout, 28-minute warning).
 *  3. Shows a countdown modal at 28 minutes with a "Continuar sesión" button.
 *  4. On timeout: revokes the access token server-side, signs out of Supabase,
 *     broadcasts to other tabs, and redirects to /login?expired=1.
 */
export function SessionGuard({ children }: SessionGuardProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  // Track session state on the client
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  // Stable ref to avoid stale closure in BroadcastChannel handler
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  /**
   * Full logout sequence triggered by this tab's inactivity timer.
   * 1. Revoke access token on the backend (best-effort).
   * 2. Sign out from Supabase (revokes refresh token).
   * 3. Broadcast logout to other tabs.
   * 4. Redirect to /login.
   */
  const handleTimeout = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    // 1. Backend revocation — best-effort, don't block logout on failure
    if (token) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // Network failure — continue with client-side logout regardless
      }
    }

    // 2. Revoke refresh token in Supabase
    await supabase.auth.signOut();

    // 3. Notify other tabs
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BC_CHANNEL);
      bc.postMessage({ type: 'logout' });
      bc.close();
    }

    // 4. Redirect with context
    routerRef.current.push('/login?expired=1');
  }, [supabase]);

  /**
   * Called when another tab broadcasts logout — just redirect, no backend call.
   */
  const handleRemoteLogout = useCallback(() => {
    routerRef.current.push('/login?expired=1');
  }, []);

  const { showWarning, secondsLeft, continueSession } = useInactivityTimer({
    enabled: !!session,
    onTimeout: handleTimeout,
    onRemoteLogout: handleRemoteLogout,
  });

  return (
    <>
      {children}
      {showWarning && (
        <InactivityModal secondsLeft={secondsLeft} onContinue={continueSession} />
      )}
    </>
  );
}
