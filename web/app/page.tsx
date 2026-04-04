"use client";

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

  if (auth.isLoading) {
    return (
      <div className="app-shell">
        <header className="site-header site-header--chat" aria-label="Application header">
          <div className="site-header__inner site-header__inner--chat">
            <div className="site-header__topline site-header__topline--chat">
              <div className="site-header__side-rail site-header__side-rail--start" aria-hidden="true" />
              <SiteHeaderLogo />
              <div className="site-header__side-rail site-header__side-rail--end" aria-hidden="true" />
            </div>
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
      <header className="site-header site-header--chat" aria-label="Application header">
        <div className="site-header__inner site-header__inner--chat">
          <div className="site-header__topline site-header__topline--chat">
            <div className="site-header__side-rail site-header__side-rail--start" aria-hidden="true" />
            <SiteHeaderLogo />
            <div className="site-header__side-rail site-header__side-rail--end" aria-hidden="true" />
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
            showSearch={false}
            onChange={setMobilePrompt}
            onSubmit={handleMobilePromptSubmit}
            topics={[...MOBILE_HOME_TOPICS]}
          />
          <section className="landing-auth landing-auth--mobile ds-panel" role="group" aria-label="Get started">
            <p className="landing-auth__label">Get started</p>
            <p className="landing-auth__guest-note landing-auth__guest-note--intro landing-auth__guest-note--mobile">
              By logging in, you are agreeing to the terms of service listed below.
            </p>
            <div className="landing-auth__actions landing-auth__actions--mobile">
              <button
                type="button"
                className="ds-button ds-button--primary landing-auth__btn landing-auth__btn--mobile"
                onClick={() => router.push("/login")}
              >
                Log In
              </button>

              <button
                type="button"
                className="ds-button landing-auth__btn landing-auth__btn--mobile"
                onClick={() => router.push("/signup")}
              >
                Create Account
              </button>

              <button
                type="button"
                className="ds-button ds-button--ghost landing-auth__btn landing-auth__btn--guest landing-auth__btn--mobile"
                onClick={handleGuestSignIn}
                disabled={isSigningInAsGuest}
              >
                {isSigningInAsGuest ? "Signing in…" : "Continue as Guest"}
              </button>
            </div>

            {guestError ? (
              <p className="error landing-auth__error landing-auth__error--mobile" role="alert">{guestError}</p>
            ) : null}

            <p className="landing-auth__guest-note landing-auth__guest-note--mobile">
              Guest mode creates an anonymous account for this browser so chat and history work like a
              signed-in user. Create an account if you want to access your chats across devices or keep
              them long-term.
            </p>

            <div className="landing-auth__terms landing-auth__terms--mobile" aria-label="Terms of service">
              <h2 className="landing-auth__terms-title">Terms of Service</h2>
              <p className="landing-auth__terms-text">
                By using ArmyRegs.ai, I agree to the following:
              </p>
              <ol className="landing-auth__terms-list">
                <li className="landing-auth__terms-text">
                  I will not enter Personally Identifying Information (PII), HIPAA Protected Health
                  Information (PHI), classified information, Controlled Unclassified Information (CUI),
                  or other sensitive or restricted data.
                </li>
                <li className="landing-auth__terms-text">
                  ArmyRegs.ai is provided for informational and research assistance only. It does not
                  provide legal advice, official Army guidance, or professional advice of any kind.
                </li>
                <li className="landing-auth__terms-text">
                  Use of ArmyRegs.ai does not create an attorney-client relationship, advisory
                  relationship, or any official relationship with the U.S. Army, the Department of
                  Defense, or any government agency.
                </li>
                <li className="landing-auth__terms-text">
                  I am responsible for reviewing and verifying all outputs against official Army
                  Regulations and other authoritative sources, and for consulting a qualified legal
                  professional when needed.
                </li>
                <li className="landing-auth__terms-text">
                  I will not use the service for unlawful purposes, security testing, reverse
                  engineering, abuse of the system, or submission of restricted or sensitive
                  information.
                </li>
                <li className="landing-auth__terms-text">
                  Responses may be incomplete, inaccurate, or outdated. The service may be changed,
                  interrupted, or discontinued at any time.
                </li>
                <li className="landing-auth__terms-text">
                  ArmyRegs.ai is a private tool and is not affiliated with, endorsed by, or speaking on
                  behalf of the U.S. Army, DoD, or any government agency.
                </li>
                <li className="landing-auth__terms-text">
                  I am solely responsible for my use of the service, my inputs, and any decisions,
                  actions, or work product based on its outputs.
                </li>
                <li className="landing-auth__terms-text">
                  The service is provided &ldquo;as is&rdquo; without warranties, and ArmyRegs.ai is not
                  liable for losses or damages arising from use of the service.
                </li>
                <li className="landing-auth__terms-text">
                  ArmyRegs.ai may suspend access for misuse or violation of these terms and may update
                  these terms from time to time.
                </li>
              </ol>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
