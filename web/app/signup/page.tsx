"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  signUpWithEmail,
  updateUserProfile,
  signInWithGoogle,
  signInWithFacebook
} from "../../lib/auth-actions";
import { ensureUserProfile } from "../../lib/firestore-actions";
import SiteHeaderLogo from "../../components/ui/site-header-logo";

export default function SignupPage() {
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectToChat = () => router.replace("/chat");

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await signUpWithEmail(email, password);

      if (displayName.trim()) {
        await updateUserProfile(user, { displayName: displayName.trim() });
      }

      await ensureUserProfile(user);
      redirectToChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <SiteHeaderLogo />
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-card ds-panel">
          <div className="auth-card__header">
            <h1 className="auth-card__title">Create Account</h1>
            <p className="auth-card__subtitle">Join ArmyRegs.ai</p>
          </div>

          {/* Social sign-up */}
          <div className="auth-social" aria-label="Sign up with social provider">
            <button
              type="button"
              className="ds-button auth-social__btn auth-social__btn--google"
              onClick={() => handleSocial(signInWithGoogle)}
              disabled={isSubmitting}
              aria-label="Sign up with Google"
            >
              <svg className="auth-social__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              className="ds-button auth-social__btn auth-social__btn--facebook"
              onClick={() => handleSocial(signInWithFacebook)}
              disabled={isSubmitting}
              aria-label="Sign up with Facebook"
            >
              <svg className="auth-social__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
              </svg>
              Continue with Facebook
            </button>
          </div>

          <div className="auth-divider" aria-hidden="true">
            <span className="auth-divider__text">or create with email</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} aria-label="Create account with email">
            <label className="auth-form__label" htmlFor="signup-name">
              Display Name <span className="auth-form__optional">(optional)</span>
            </label>
            <input
              id="signup-name"
              type="text"
              className="ds-input auth-form__input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              autoFocus
              placeholder="Maj. Smith"
            />

            <label className="auth-form__label" htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              className="ds-input auth-form__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <label className="auth-form__label" htmlFor="signup-password">Password</label>
            <p className="auth-form__hint">Minimum 8 characters.</p>
            <div className="auth-form__password-wrap">
              <input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                className="ds-input auth-form__input auth-form__input--password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
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

            <label className="auth-form__label" htmlFor="signup-confirm">Confirm Password</label>
            <input
              id="signup-confirm"
              type={showPassword ? "text" : "password"}
              className="ds-input auth-form__input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />

            {error && <p className="error" role="alert">{error}</p>}

            <button
              type="submit"
              className="ds-button ds-button--primary auth-form__submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <div className="auth-card__footer">
            <p className="auth-card__footer-text">
              Already have an account?{" "}
              <Link href="/login" className="auth-card__footer-link">Sign in</Link>
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
