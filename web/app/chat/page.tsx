"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useFirebaseAuth } from "../../components/auth/auth-provider";
import ChatShell from "../../components/chat/chat-shell";
import SiteHeaderLogo from "../../components/ui/site-header-logo";

const LAST_REGULATION_SYNC_LABEL = "March 7, 2026";

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

export default function ChatPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();

  // Client-side fallback guard — middleware handles the server-side redirect.
  useEffect(() => {
    if (!auth.isLoading && !auth.user) {
      router.replace("/");
    }
  }, [auth.isLoading, auth.user, router]);

  if (auth.isLoading || !auth.user) {
    return null;
  }

  return (
    <div className="app-shell chat-page">
      <header className="site-header site-header--chat" aria-label="Application header">
        <div className="site-header__inner site-header__inner--chat">
          <div className="site-header__topline site-header__topline--chat">
            <SiteHeaderLogo />

            <div className="site-header__actions site-header__actions--chat">
              <Link
                href="/member"
                className="ds-button ds-button--ghost site-header__clear-button"
                title="View conversation history"
              >
                <HistoryIcon />
                <span className="site-header__action-label">History</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <ChatShell regulationSyncLabel={LAST_REGULATION_SYNC_LABEL} />
    </div>
  );
}
