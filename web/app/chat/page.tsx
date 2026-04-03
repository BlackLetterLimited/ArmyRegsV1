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
        d="M12 12.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM5.5 19.25a6.5 6.5 0 0 1 13 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
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
