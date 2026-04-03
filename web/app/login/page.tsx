"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  confirmMagicLink,
  isMagicLinkUrl,
  resetPassword,
  sendMagicLink,
  signInWithEmail,
  signInWithFacebook,
  signInWithGoogle
} from "../../lib/auth-actions";
import { ensureUserProfile } from "../../lib/firestore-actions";
import SiteHeaderLogo from "../../components/ui/site-header-logo";

// ---------------------------------------------------------------------------
// Magic-link confirmation — runs on page load when redirected back from email
// ---------------------------------------------------------------------------

function MagicLinkConfirmation({ onSuccess }: { onSuccess: () => void }) {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"checking" | "success" | "error" | "prompt">("checking");
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMagicLinkUrl(window.location.href)) {
      setStatus("prompt");
      return;
    }
    // Try to confirm without prompting if we have the email in localStorage.
    confirmMagicLink(window.location.href)
      .then(async (user) => {
        await ensureUserProfile(user);
        setStatus("success");
        onSuccess();
      })
      .catch(() => {
        // Email not in localStorage — ask the user to re-enter it.
        setStatus("prompt");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (status === "checking") {
    return <p className="auth-form__hint">Confirming your magic link…</p>;
  }

  if (status === "success") {
    return <p className="auth-form__hint">Signed in! Redirecting…</p>;
  }

  if (status === "prompt") {
    const handleConfirm = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      try {
        const user = await confirmMagicLink(window.location.href, emailInput);
        await ensureUserProfile(user);
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to confirm magic link.");
      }
    };

    return (
      <form className="auth-form" onSubmit={handleConfirm} aria-label="Confirm magic link">
        <p className="auth-form__hint">Please re-enter your email address to complete sign-in.</p>
        <label className="auth-form__label" htmlFor="ml-confirm-email">Email</label>
        <input
          id="ml-confirm-email"
          type="email"
          className="ds-input auth-form__input"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          required
          autoFocus
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="ds-button ds-button--primary auth-form__submit">
          Confirm &amp; Sign In
        </button>
      </form>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main login page
// ---------------------------------------------------------------------------

type LoginTab = "password" | "magic";

function LoginContent() {
  const router = useRouter();
  const [tab, setTab] = useState<LoginTab>("password");

  // Password tab state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Magic link tab state
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const isMagicLink =
    typeof window !== "undefined" && isMagicLinkUrl(window.location.href);

  const redirectToChat = () => router.replace("/chat");

  // Social sign-in helper
  const handleSocial = async (fn: () => Promise<import("firebase/auth").User>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await fn();
      await ensureUserProfile(user);
      redirectToChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Social sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Email + password
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await signInWithEmail(email, password);
      await ensureUserProfile(user);
      redirectToChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Magic link send
  const handleMagicLinkSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setMagicError(null);
    setMagicSubmitting(true);
    try {
      const redirectUrl = `${window.location.origin}/login`;
      await sendMagicLink(magicEmail, redirectUrl);
      setMagicSent(true);
    } catch (err) {
      setMagicError(err instanceof Error ? err.message : "Failed to send magic link.");
    } finally {
      setMagicSubmitting(false);
    }
  };

  // Forgot password send
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    try {
      await resetPassword(forgotEmail);
      setForgotSent(true);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Failed to send reset email.");
    }
  };

  return (
    <div className="auth-page">
      <header className="site-header site-header--chat" aria-label="Application header">
        <div className="site-header__inner site-header__inner--chat">
          <div className="site-header__topline site-header__topline--chat">
            <SiteHeaderLogo />
          </div>
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-card ds-panel">
          <div className="auth-card__header">
            <h1 className="auth-card__title">Sign In</h1>
            <p className="auth-card__subtitle">Access ArmyRegs.ai</p>
          </div>

          {/* If this page load is a magic-link callback, show the confirmation flow */}
          {isMagicLink ? (
            <Suspense fallback={<p className="auth-form__hint">Loading…</p>}>
              <MagicLinkConfirmation onSuccess={redirectToChat} />
            </Suspense>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
                <button
                  role="tab"
                  aria-selected={tab === "password"}
                  className={`auth-tab ${tab === "password" ? "auth-tab--active" : ""}`}
                  onClick={() => { setTab("password"); setError(null); }}
                >
                  Email &amp; Password
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "magic"}
                  className={`auth-tab ${tab === "magic" ? "auth-tab--active" : ""}`}
                  onClick={() => { setTab("magic"); setError(null); }}
                >
                  Magic Link
                </button>
              </div>

              {/* Social providers */}
              <div className="auth-social" aria-label="Social sign-in">
                <button
                  type="button"
                  className="ds-button auth-social__btn auth-social__btn--google"
                  onClick={() => handleSocial(signInWithGoogle)}
                  disabled={isSubmitting}
                  aria-label="Sign in with Google"
                >
                  <svg className="auth-social__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>

                <button
                  type="button"
                  className="ds-button auth-social__btn auth-social__btn--facebook"
                  onClick={() => handleSocial(signInWithFacebook)}
                  disabled={isSubmitting}
                  aria-label="Sign in with Facebook"
                >
                  <svg className="auth-social__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                  </svg>
                  Sign in with Facebook
                </button>
              </div>

              <div className="auth-divider" aria-hidden="true">
                <span className="auth-divider__text">or</span>
              </div>

              {/* Password tab */}
              {tab === "password" && !showForgot && (
                <form className="auth-form" onSubmit={handlePasswordSubmit} aria-label="Sign in with email and password">
                  <label className="auth-form__label" htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    className="ds-input auth-form__input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    autoFocus
                  />

                  <div className="auth-form__label-row">
                    <label className="auth-form__label" htmlFor="login-password">Password</label>
                    <button
                      type="button"
                      className="auth-form__link-btn"
                      onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="auth-form__password-wrap">
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      className="ds-input auth-form__input auth-form__input--password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="auth-form__show-password"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>

                  {error && <p className="error" role="alert">{error}</p>}

                  <button
                    type="submit"
                    className="ds-button ds-button--primary auth-form__submit"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Signing in…" : "Sign In"}
                  </button>
                </form>
              )}

              {/* Forgot password sub-form */}
              {tab === "password" && showForgot && (
                <div className="auth-form" aria-label="Reset password">
                  {forgotSent ? (
                    <>
                      <p className="auth-form__hint auth-form__hint--success">
                        Reset link sent! Check your email.
                      </p>
                      <button
                        type="button"
                        className="auth-form__link-btn"
                        onClick={() => { setShowForgot(false); setForgotSent(false); }}
                      >
                        ← Back to sign in
                      </button>
                    </>
                  ) : (
                    <form onSubmit={handleForgotSubmit}>
                      <p className="auth-form__hint">Enter your email to receive a password reset link.</p>
                      <label className="auth-form__label" htmlFor="forgot-email">Email</label>
                      <input
                        id="forgot-email"
                        type="email"
                        className="ds-input auth-form__input"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                        autoFocus
                      />
                      {forgotError && <p className="error" role="alert">{forgotError}</p>}
                      <button type="submit" className="ds-button ds-button--primary auth-form__submit">
                        Send Reset Link
                      </button>
                      <button
                        type="button"
                        className="auth-form__link-btn"
                        onClick={() => setShowForgot(false)}
                      >
                        ← Back to sign in
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Magic link tab */}
              {tab === "magic" && (
                <div className="auth-form" aria-label="Magic link sign-in">
                  {magicSent ? (
                    <>
                      <p className="auth-form__hint auth-form__hint--success">
                        Magic link sent to <strong>{magicEmail}</strong>. Check your inbox and click the link to sign in.
                      </p>
                      <button
                        type="button"
                        className="auth-form__link-btn"
                        onClick={() => { setMagicSent(false); setMagicEmail(""); }}
                      >
                        Send to a different email
                      </button>
                    </>
                  ) : (
                    <form onSubmit={handleMagicLinkSend}>
                      <p className="auth-form__hint">
                        We&apos;ll email you a link — no password needed.
                      </p>
                      <label className="auth-form__label" htmlFor="magic-email">Email</label>
                      <input
                        id="magic-email"
                        type="email"
                        className="ds-input auth-form__input auth-form__input--below-label"
                        value={magicEmail}
                        onChange={(e) => setMagicEmail(e.target.value)}
                        autoComplete="email"
                        required
                        autoFocus
                      />
                      {magicError && <p className="error" role="alert">{magicError}</p>}
                      <button
                        type="submit"
                        className="ds-button ds-button--primary auth-form__submit"
                        disabled={magicSubmitting}
                      >
                        {magicSubmitting ? "Sending…" : "Send Magic Link"}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </>
          )}

          <div className="auth-card__footer">
            <p className="auth-card__footer-text">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="auth-card__footer-link">Create one</Link>
            </p>
            <p className="auth-card__footer-text">
              <Link href="/" className="auth-card__footer-link">← Back to home</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
