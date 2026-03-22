"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFirebaseAuth } from "../components/auth/auth-provider";
import SiteHeaderLogo from "../components/ui/site-header-logo";

export default function LandingPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [isSigningInAsGuest, setIsSigningInAsGuest] = useState(false);

  // If a session already exists (returning user), send them straight to chat.
  useEffect(() => {
    if (!auth.isLoading && auth.user) {
      router.replace("/chat");
    }
  }, [auth.isLoading, auth.user, router]);

  const handleGuestSignIn = async () => {
    setGuestError(null);
    setIsSigningInAsGuest(true);
    try {
      await auth.signInAsGuest();
      router.replace("/chat");
    } catch (err) {
      setGuestError(err instanceof Error ? err.message : "Failed to continue as guest.");
    } finally {
      setIsSigningInAsGuest(false);
    }
  };

  if (auth.isLoading) {
    return (
      <div className="app-shell">
        <header className="site-header" aria-label="Application header">
          <div className="site-header__inner">
            <SiteHeaderLogo />
          </div>
        </header>
        <div className="landing-loading" aria-label="Loading">
          <div className="landing-loading__spinner" aria-hidden="true" />
          <p className="landing-loading__text">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell landing-shell">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <SiteHeaderLogo />
        </div>
      </header>

      <main className="landing-main" aria-label="Welcome to ArmyRegs.ai">
        <div className="landing-panel">
          {/* Hero / welcome card */}
          <section className="chat-empty-state landing-hero" aria-labelledby="landing-title">
            <h1 className="chat-empty-state__title" id="landing-title">Welcome to ArmyRegs.ai</h1>

            <p className="chat-empty-state__body">
              ArmyRegs.ai helps you quickly research Army regulations by turning plain-language
              questions into structured answers tied to specific regulatory sources. Each response is
              grounded in cited paragraphs so you can trace the reasoning, verify the underlying
              authority, and move faster from question to actionable guidance.
            </p>

            {/* Auth box */}
            <div className="landing-auth" role="group" aria-label="Sign in options">
              <p className="landing-auth__label">Get started</p>

              <div className="landing-auth__actions">
                <button
                  type="button"
                  className="ds-button ds-button--primary landing-auth__btn"
                  onClick={() => router.push("/login")}
                >
                  Log In
                </button>

                <button
                  type="button"
                  className="ds-button landing-auth__btn"
                  onClick={() => router.push("/signup")}
                >
                  Create Account
                </button>

                <button
                  type="button"
                  className="ds-button ds-button--ghost landing-auth__btn landing-auth__btn--guest"
                  onClick={handleGuestSignIn}
                  disabled={isSigningInAsGuest}
                >
                  {isSigningInAsGuest ? "Signing in…" : "Continue as Guest"}
                </button>
              </div>

              {guestError && (
                <p className="error landing-auth__error" role="alert">{guestError}</p>
              )}

              <p className="landing-auth__guest-note">
                Guest mode creates an anonymous account for this browser so chat and history work like a
                signed-in user. Create an account if you want to access your chats across devices or keep them long-term.
              </p>
            </div>
          </section>

          {/* Legal disclaimer */}
          <aside className="chat-empty-disclaimer" aria-label="Usage warning">
            <h2 className="chat-empty-disclaimer__title">Notice</h2>
            <p className="chat-empty-disclaimer__text">
              Do not include any Personally Identifying Information (PII), HIPAA Protected Health
              Information (PHI), or classified (including CUI) information.
            </p>
            <p className="chat-empty-disclaimer__text">
              This tool does not constitute legal advice and should not be used as a substitute for
              consulting the actual regulations or a legal professional. Always verify the
              information provided by this tool against the official Army Regulations and consult
              with a qualified legal advisor for any specific questions or concerns.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
