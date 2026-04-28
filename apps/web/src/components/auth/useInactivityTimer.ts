'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const INACTIVE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARN_BEFORE_MS = 2 * 60 * 1000;        // warn 2 minutes before logout
const WARN_AT_MS = INACTIVE_TIMEOUT_MS - WARN_BEFORE_MS; // 28 minutes

const STORAGE_KEY = 'alpha_last_activity';
const BC_CHANNEL = 'alpha_session';

type BcMessage = { type: 'activity' } | { type: 'logout' };

interface UseInactivityTimerOptions {
  /** Only attach listeners and run timers when true. */
  enabled: boolean;
  /** Called when the 30-minute inactivity timeout fires in this tab. */
  onTimeout: () => void;
  /** Called when another tab broadcasts a logout event. */
  onRemoteLogout: () => void;
}

interface UseInactivityTimerResult {
  showWarning: boolean;
  secondsLeft: number;
  continueSession: () => void;
}

export function useInactivityTimer({
  enabled,
  onTimeout,
  onRemoteLogout,
}: UseInactivityTimerOptions): UseInactivityTimerResult {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  // Keep callbacks in refs so timer closures don't go stale
  const onTimeoutRef = useRef(onTimeout);
  const onRemoteLogoutRef = useRef(onRemoteLogout);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);
  useEffect(() => { onRemoteLogoutRef.current = onRemoteLogout; }, [onRemoteLogout]);

  const clearAllTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    warnTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  /**
   * (Re)start both timers from `remainingMs` milliseconds.
   * @param broadcast - if true, notify other tabs via BroadcastChannel.
   */
  const scheduleTimers = useCallback((remainingMs: number, broadcast: boolean) => {
    clearAllTimers();
    setShowWarning(false);

    if (broadcast) {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      bcRef.current?.postMessage({ type: 'activity' } satisfies BcMessage);
    }

    const warnInMs = remainingMs - WARN_BEFORE_MS;

    if (warnInMs > 0) {
      warnTimerRef.current = setTimeout(() => {
        // Show warning with 120-second countdown
        setShowWarning(true);
        setSecondsLeft(120);
        countdownRef.current = setInterval(() => {
          setSecondsLeft(prev => {
            if (prev <= 1) {
              if (countdownRef.current) clearInterval(countdownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }, warnInMs);
    } else {
      // Already past the warn threshold — show warning immediately
      const countdownSecs = Math.max(1, Math.ceil(remainingMs / 1000));
      setShowWarning(true);
      setSecondsLeft(countdownSecs);
      countdownRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    logoutTimerRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, remainingMs);
  }, [clearAllTimers]);

  /** Reset timer to full 30 minutes and broadcast activity to other tabs. */
  const resetTimer = useCallback(() => {
    scheduleTimers(INACTIVE_TIMEOUT_MS, true);
  }, [scheduleTimers]);

  /** Called by the "Continuar sesión" button — same as resetTimer. */
  const continueSession = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!enabled) return;

    // Open BroadcastChannel for cross-tab sync
    if (typeof BroadcastChannel !== 'undefined') {
      bcRef.current = new BroadcastChannel(BC_CHANNEL);
      bcRef.current.onmessage = (event: MessageEvent<BcMessage>) => {
        if (event.data.type === 'activity') {
          // Another tab had activity — sync timers locally without re-broadcasting
          scheduleTimers(INACTIVE_TIMEOUT_MS, false);
        } else if (event.data.type === 'logout') {
          onRemoteLogoutRef.current();
        }
      };
    }

    // Resume timer based on last known activity (survives page refresh)
    const lastActivity = parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    const elapsed = lastActivity > 0 ? Date.now() - lastActivity : INACTIVE_TIMEOUT_MS;

    if (elapsed >= INACTIVE_TIMEOUT_MS) {
      // Already timed out before page was (re)loaded
      onTimeoutRef.current();
    } else {
      scheduleTimers(INACTIVE_TIMEOUT_MS - elapsed, false);
    }

    // DOM activity listeners
    const DOM_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    const handleActivity = () => resetTimer();
    DOM_EVENTS.forEach(ev => window.addEventListener(ev, handleActivity, { passive: true }));

    // Activity signal dispatched by api.ts on every backend request
    window.addEventListener('alpha-backend-request', handleActivity);

    return () => {
      DOM_EVENTS.forEach(ev => window.removeEventListener(ev, handleActivity));
      window.removeEventListener('alpha-backend-request', handleActivity);
      clearAllTimers();
      bcRef.current?.close();
      bcRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]); // intentionally omit stable callbacks — they're tracked via refs

  return { showWarning, secondsLeft, continueSession };
}
