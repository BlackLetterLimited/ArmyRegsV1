"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFirebaseAuth } from "../components/auth/auth-provider";
import MobileHomePanel from "../components/home/mobile-home-panel";
import SiteHeaderLogo from "../components/ui/site-header-logo";

const PENDING_PROMPT_STORAGE_KEY = "armyregs:pending-mobile-prompt";
const MOBILE_HOME_TOPICS = [
  {
    label: "Beards",
    chipLabel: "When can a commander suspend a beard accommodation?",
    prompt: "When can a commander suspend a religious beard accommodation?"
  },
  {
    label: "Flags",
    chipLabel: "What is the timeline to flag a Soldier?",
    prompt: "What is the timeline to flag a Soldier after adverse action starts?"
  },
  {
    label: "Profiles",
    chipLabel: "What are the rules for shaving profiles?",
    prompt: "What are the rules for shaving profiles and religious accommodations?"
  },
  {
    label: "15-6 IO",
    chipLabel: "Who can appoint a 15-6 investigating officer?",
    prompt: "Who can appoint a 15-6 investigating officer?"
  }
] as const;

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="site-header__action-icon">
      <path
        d="M7 6h10M7 12h10M7 18h7M4 6h.01M4 12h.01M4 18h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="site-header__action-icon">
      <circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5.5 18.5a6.5 6.5 0 0 1 13 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [isSigningInAsGuest, setIsSigningInAsGuest] = useState(false);
  const [mobilePrompt, setMobilePrompt] = useState("");

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

  const handleMobilePromptSubmit = async () => {
    const prompt = mobilePrompt.trim();
    if (!prompt) return;

    setGuestError(null);
    setIsSigningInAsGuest(true);

    try {
      sessionStorage.setItem(PENDING_PROMPT_STORAGE_KEY, prompt);
      await auth.signInAsGuest();
      router.replace("/chat");
    } catch (err) {
      sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY);
      setGuestError(err instanceof Error ? err.message : "Failed to continue as guest.");
    } finally {
      setIsSigningInAsGuest(false);
    }
  };

  const handleHistoryOpen = async () => {
    setGuestError(null);

    if (auth.user) {
      router.push("/member");
      return;
    }

    setIsSigningInAsGuest(true);
    try {
      await auth.signInAsGuest();
      router.push("/member");
    } catch (err) {
      setGuestError(err instanceof Error ? err.message : "Failed to open history.");
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
          <div className="site-header__actions site-header__actions--landing">
            <button
              type="button"
              className="ds-button ds-button--ghost site-header__clear-button site-header__clear-button--icon"
              onClick={handleHistoryOpen}
              disabled={isSigningInAsGuest}
            >
              <HistoryIcon />
              <span className="site-header__action-label">History</span>
            </button>
            <Link
              href="/login"
              className="ds-button ds-button--ghost site-header__clear-button site-header__clear-button--icon"
            >
              <ProfileIcon />
              <span className="site-header__action-label">Log In</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="landing-main" aria-label="Welcome to ArmyRegs.ai">
        <div className="landing-mobile-home">
          <MobileHomePanel
            mode="landing"
            value={mobilePrompt}
            isSubmitting={isSigningInAsGuest}
            submitLabel="Start chat"
            canSubmit={!auth.isLoading && !isSigningInAsGuest}
            onChange={setMobilePrompt}
            onSubmit={handleMobilePromptSubmit}
            topics={[...MOBILE_HOME_TOPICS]}
          />
          {guestError ? (
            <p className="error landing-auth__error landing-auth__error--mobile" role="alert">{guestError}</p>
          ) : null}
        </div>

        <div className="landing-panel landing-panel--desktop">
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
