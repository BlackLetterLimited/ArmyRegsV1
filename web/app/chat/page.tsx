"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFirebaseAuth } from "../../components/auth/auth-provider";
import ChatShell from "../../components/chat/chat-shell";
import SiteHeaderLogo from "../../components/ui/site-header-logo";

export default function ChatPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Client-side fallback guard — middleware handles the server-side redirect.
  useEffect(() => {
    if (!auth.isLoading && !auth.user) {
      router.replace("/");
    }
  }, [auth.isLoading, auth.user, router]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await auth.signOut();
      router.replace("/");
    } catch {
      setIsSigningOut(false);
    }
  };

  if (auth.isLoading || !auth.user) {
    return null;
  }

  const isAnonymous = auth.user.isAnonymous;
  const displayName = auth.user.displayName || auth.user.email || null;

  return (
    <div className="app-shell">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <SiteHeaderLogo />

          <div className="site-header__actions">
            {isAnonymous ? (
              <>
                <Link
                  href="/member"
                  className="ds-button ds-button--ghost site-header__clear-button"
                  title="Conversation history for this guest session"
                >
                  History
                </Link>
                <Link href="/login" className="ds-button ds-button--ghost site-header__clear-button">
                  Sign In
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/member"
                  className="ds-button ds-button--ghost site-header__clear-button"
                  title="View your conversation history"
                >
                  {displayName ? displayName : "My Account"}
                </Link>
                <button
                  type="button"
                  className="ds-button ds-button--ghost site-header__clear-button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? "Signing out…" : "Sign Out"}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <ChatShell />
    </div>
  );
}
