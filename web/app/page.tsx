"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFirebaseAuth } from "../components/auth/auth-provider";
import logo from "../logo.png";

const LANDING_HIGHLIGHTS = [
  {
    title: "Built for research",
    body: "Find the controlling Army regulation faster when you know the issue but not the citation.",
  },
  {
    title: "Citation-backed answers",
    body: "Every response is tied to the underlying authority so you can inspect the exact paragraph.",
  },
  {
    title: "Open the source",
    body: "Review the regulation PDF in context before relying on any answer or recommendation.",
  },
] as const;

const TERMS_OF_SERVICE = [
  "I will not enter Personally Identifying Information (PII), HIPAA Protected Health Information (PHI), classified information, Controlled Unclassified Information (CUI), or other sensitive or restricted data.",
  "ArmyRegs.ai is provided for informational and research assistance only. It does not provide legal advice, official Army guidance, or professional advice of any kind.",
  "Use of ArmyRegs.ai does not create an attorney-client relationship, advisory relationship, or any official relationship with the U.S. Army, the Department of Defense, or any government agency.",
  "I am responsible for reviewing and verifying all outputs against official Army Regulations and other authoritative sources, and for consulting a qualified legal professional when needed.",
  "I will not use the service for unlawful purposes, security testing, reverse engineering, abuse of the system, or submission of restricted or sensitive information.",
  "Responses may be incomplete, inaccurate, or outdated. The service may be changed, interrupted, or discontinued at any time.",
  "ArmyRegs.ai is a private tool and is not affiliated with, endorsed by, or speaking on behalf of the U.S. Army, DoD, or any government agency.",
  "I am solely responsible for my use of the service, my inputs, and any decisions, actions, or work product based on its outputs.",
  'The service is provided "as is" without warranties, and ArmyRegs.ai is not liable for losses or damages arising from use of the service.',
  "ArmyRegs.ai may suspend access for misuse or violation of these terms and may update these terms from time to time.",
] as const;

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mobile-home__row-chevron"
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [isSigningInAsGuest, setIsSigningInAsGuest] = useState(false);
  const [isLearnMoreOpen, setIsLearnMoreOpen] = useState(false);

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
      setGuestError(
        err instanceof Error ? err.message : "Failed to continue as guest.",
      );
    } finally {
      setIsSigningInAsGuest(false);
    }
  };

  if (auth.isLoading) {
    return (
      <div className="app-shell landing-shell">
        <div className="landing-loading" aria-label="Loading">
          <div className="landing-loading__spinner" aria-hidden="true" />
          <p className="landing-loading__text">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell landing-shell">
      <main
        className="landing-main landing-main--home"
        aria-label="Welcome to ArmyRegs.ai"
      >
        <section
          className="chat-home landing-home"
          aria-label="ArmyRegs.ai onboarding"
        >
          <div className="chat-home__hero landing-home__hero">
            <Link href="/" className="chat-home__logo-wrap site-header__logo-link" aria-label="ArmyRegs.ai — Home">
              <Image
                src={logo}
                alt="ArmyRegs.ai"
                width={1093}
                height={253}
                className="chat-home__logo"
                sizes="(max-width: 768px) 82vw, 560px"
              />
            </Link>

            <article
              className="landing-hero-card"
              aria-labelledby="landing-hero-title"
            >
              <p className="landing-hero-card__eyebrow">
                Army Regulation Research
              </p>
              <h1 className="landing-hero-card__title" id="landing-hero-title">
                AI-powered Army regulation research with precise, verifiable
                citations.
              </h1>
              <p className="landing-hero-card__body">
                Ask plain-language questions. <br></br>Get answers tied to exact
                regulation paragraphs, then open the source PDF to review the
                text in context before you rely on it.
              </p>
              <button
                type="button"
                className="mobile-home__learn-more landing-hero-card__learn-more"
                aria-expanded={isLearnMoreOpen}
                aria-controls="landing-hero-details"
                onClick={() => setIsLearnMoreOpen((current) => !current)}
              >
                <span>Learn More</span>
                <span
                  className={`mobile-home__learn-more-chevron${isLearnMoreOpen ? " is-open" : ""}`}
                >
                  <ChevronIcon />
                </span>
              </button>
              {isLearnMoreOpen ? (
                <div
                  id="landing-hero-details"
                  className="landing-hero-card__highlights"
                  aria-label="Key capabilities"
                >
                  {LANDING_HIGHLIGHTS.map((highlight) => (
                    <div key={highlight.title} className="landing-highlight">
                      <p className="landing-highlight__title">
                        {highlight.title}
                      </p>
                      <p className="landing-highlight__body">
                        {highlight.body}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>

            <section
              className="landing-get-started"
              aria-labelledby="landing-get-started-title"
            >
              <div className="landing-get-started__header">
                <h2
                  className="landing-get-started__title"
                  id="landing-get-started-title"
                >
                  Get started
                </h2>
                <p className="landing-get-started__intro">
                  By clicking, you agree to the terms of service listed below.
                </p>
              </div>

              <div className="landing-get-started__actions">
                <Link
                  href="/login"
                  className="ds-button ds-button--primary landing-get-started__button landing-get-started__button--primary"
                >
                  Log In
                </Link>

                <Link
                  href="/signup"
                  className="ds-button landing-get-started__button landing-get-started__button--secondary"
                >
                  Create Account
                </Link>

                <button
                  type="button"
                  className="ds-button ds-button--ghost landing-get-started__button landing-get-started__button--guest"
                  onClick={handleGuestSignIn}
                  disabled={isSigningInAsGuest}
                >
                  {isSigningInAsGuest ? "Signing in…" : "Continue as Guest"}
                </button>

                <div className="landing-get-started__guest-note-box">
                  <p className="landing-get-started__guest-note">
                    Guest mode is a temporary anonymous account so chat and
                    history work without signing up.
                  </p>
                </div>
              </div>

              {guestError ? (
                <p className="error landing-get-started__error" role="alert">
                  {guestError}
                </p>
              ) : null}
            </section>

            <section
              className="landing-terms-card"
              aria-labelledby="landing-terms-title"
            >
              <h2
                className="landing-terms-card__title"
                id="landing-terms-title"
              >
                Terms of Service
              </h2>
              <p className="landing-terms-card__intro">
                By using ArmyRegs.ai, I agree to the following:
              </p>
              <ol className="landing-terms-card__list">
                {TERMS_OF_SERVICE.map((term) => (
                  <li key={term} className="landing-terms-card__item">
                    {term}
                  </li>
                ))}
              </ol>
            </section>

            <p className="chat-home__copyright">
              &copy; 2026 Blackletter Limited. All rights reserved.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
