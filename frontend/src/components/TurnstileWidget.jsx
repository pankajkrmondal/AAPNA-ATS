/**
 * TurnstileWidget — Cloudflare Turnstile bot-protection challenge.
 *
 * Renders the managed Turnstile widget and reports the resulting one-time
 * token to the parent via onToken. The Turnstile script is loaded on demand
 * (once per page) so public pages that never show the widget pay no cost.
 *
 * Renders nothing when no site key is configured, so environments without
 * Turnstile keys keep working unchanged. The parent can call reset() through
 * a ref after a failed login — tokens are single-use.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import useTheme from '../hooks/useTheme';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next mount
      reject(new Error('Failed to load the Turnstile script'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const TurnstileWidget = forwardRef(function TurnstileWidget({ siteKey, onToken, action = 'login' }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const { isDark } = useTheme();
  // Cloudflare renders its own "Verification failed / Troubleshoot" UI inside
  // the widget's cross-origin iframe on failure — meaningless to an end user
  // and not something we can restyle. Track the failure ourselves so we can
  // hide that iframe and show a message that actually makes sense instead.
  const [hasError, setHasError] = useState(false);

  const requestFreshChallenge = () => {
    setHasError(false);
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  };

  useImperativeHandle(ref, () => ({
    /** Discard the current (single-use) token and request a fresh challenge. */
    reset: requestFreshChallenge,
  }));

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: isDark ? 'dark' : 'light',
          action,
          callback: (token) => {
            setHasError(false);
            onTokenRef.current(token);
          },
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => {
            onTokenRef.current('');
            setHasError(true);
          },
        });
      })
      .catch(() => {
        // Script blocked/unreachable: leave the slot empty. The backend still
        // enforces verification, so the login fails with a clear error rather
        // than silently skipping bot protection.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, isDark, action]);

  if (!siteKey) return null;
  return (
    <div>
      <div ref={containerRef} style={{ minHeight: hasError ? 0 : 65, display: hasError ? 'none' : 'block' }} />
      {hasError && (
        <Alert
          type="warning"
          showIcon
          message="Verification check failed"
          description="This is usually temporary. Click retry to request a new check."
          action={
            <Button size="small" onClick={requestFreshChallenge}>
              Retry
            </Button>
          }
          style={{ borderRadius: 8 }}
        />
      )}
    </div>
  );
});

export default TurnstileWidget;
