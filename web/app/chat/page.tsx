"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
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

function AdminIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="site-header__action-icon">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 9h8M8 12h3M14 12h2M8 15h2M13 15h3"
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
  const [hasMessages, setHasMessages] = useState(false);
  const showAdminLink = auth.isAdmin;

  // Client-side fallback guard — middleware handles the server-side redirect.
  useEffect(() => {
    if (!auth.isLoading && !auth.user) {
      router.replace("/");
    }
  }, [auth.isLoading, auth.user, router]);

  useEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    const resetRootScroll = () => {
      const scrollingElement = document.scrollingElement;
      if (scrollingElement) {
        scrollingElement.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    };

    html.classList.add("chat-page-scroll-lock");
    body.classList.add("chat-page-scroll-lock");
    resetRootScroll();

    const frameId = window.requestAnimationFrame(() => {
      resetRootScroll();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      html.classList.remove("chat-page-scroll-lock");
      body.classList.remove("chat-page-scroll-lock");
    };
  }, []);

  if (auth.isLoading || !auth.user) {
    return null;
  }

  const handleHeaderLogoClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!hasMessages) return;

    event.preventDefault();
    window.dispatchEvent(new Event("jag:new-topic"));
  };

  return (
    <div className={`app-shell chat-page${hasMessages ? " chat-page--with-header" : ""}`}>
      {hasMessages ? (
        <header className="site-header site-header--chat" aria-label="Application header">
          <div className="site-header__inner site-header__inner--chat">
            <div className="site-header__topline site-header__topline--chat">
              <div className="site-header__side-rail site-header__side-rail--start" aria-hidden="true" />
              <SiteHeaderLogo ariaLabel="ArmyRegs.ai — New topic" onClick={handleHeaderLogoClick} />

              <div className="site-header__side-rail site-header__side-rail--end">
                <div className="site-header__actions site-header__actions--chat">
                  <Link
                    href="/member"
                    className="ds-button ds-button--ghost site-header__clear-button"
                    title="View conversation history"
                  >
                    <HistoryIcon />
                    <span className="site-header__action-label">History</span>
                  </Link>
                  {showAdminLink ? (
                    <Link
                      href="/admin"
                      className="ds-button ds-button--ghost site-header__clear-button"
                      title="Open admin console"
                    >
                      <AdminIcon />
                      <span className="site-header__action-label">Admin</span>
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </header>
      ) : (
        <div className="chat-page__top-actions">
          <div className="chat-page__top-actions__cluster">
            <Link
              href="/member"
              className="ds-button ds-button--ghost site-header__clear-button chat-page__history-button"
              title="View conversation history"
            >
              <HistoryIcon />
              <span className="site-header__action-label">History</span>
            </Link>
            {showAdminLink ? (
              <Link
                href="/admin"
                className="ds-button ds-button--ghost site-header__clear-button chat-page__history-button"
                title="Open admin console"
              >
                <AdminIcon />
                <span className="site-header__action-label">Admin</span>
              </Link>
            ) : null}
          </div>
        </div>
      )}

      <ChatShell regulationSyncLabel={LAST_REGULATION_SYNC_LABEL} onHasMessagesChange={setHasMessages} />
    </div>
  );
}
