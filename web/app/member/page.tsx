"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFirebaseAuth } from "../../components/auth/auth-provider";
import ChatMessageBubble from "../../components/chat/chat-message";
import SiteHeaderLogo from "../../components/ui/site-header-logo";
import DocumentPreview from "../../components/chat/document-preview";
import { getConversations, getMessages, type ConversationRecord, type MessageRecord } from "../../lib/firestore-actions";
import type { SourceExcerpt } from "../../lib/jag-chat";

export default function MemberPage() {
  const router = useRouter();
  const auth = useFirebaseAuth();

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [isLoadingConvs, setIsLoadingConvs] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<SourceExcerpt | null>(null);

  // Redirect unauthenticated users (guests use Firebase anonymous auth and have a real uid).
  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.user) {
      router.replace("/");
    }
  }, [auth.isLoading, auth.user, router]);

  // Load conversation list once we have a confirmed authenticated user.
  useEffect(() => {
    if (!auth.user) return;

    setIsLoadingConvs(true);
    setError(null);

    getConversations(auth.user.uid)
      .then(setConversations)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversations."))
      .finally(() => setIsLoadingConvs(false));
  }, [auth.user]);

  // Load messages when a conversation is selected.
  useEffect(() => {
    if (!selectedConversation || !auth.user) return;

    setIsLoadingMessages(true);
    setMessages([]);

    getMessages(auth.user.uid, selectedConversation.id)
      .then(setMessages)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load messages."))
      .finally(() => setIsLoadingMessages(false));
  }, [selectedConversation, auth.user]);

  if (auth.isLoading || !auth.user) {
    return null;
  }

  const displayName = auth.user.isAnonymous
    ? "Guest"
    : auth.user.displayName || auth.user.email || "Account";

  const formatDate = (ts: ConversationRecord["createdAt"]): string => {
    if (!ts) return "";
    try {
      return ts.toDate().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch {
      return "";
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header" aria-label="Application header">
        <div className="site-header__inner">
          <SiteHeaderLogo />
          <div className="site-header__actions site-header__actions--member">
            <Link href="/chat" className="ds-button ds-button--ghost site-header__clear-button">
              ← Back to Chat
            </Link>
          </div>
        </div>
      </header>

      <main
        className={`member-main workspace-shell${activeCitation ? " workspace-shell--with-drawer" : ""}`}
        aria-label="Conversation history"
      >
        <div className="member-main__primary">
          <div className="member-header">
            <h1 className="ds-heading-1 member-header__title">Conversation History</h1>
            <p className="ds-text-muted member-header__subtitle">Signed in as {displayName}</p>
            {auth.user.isAnonymous ? (
              <p className="ds-text-muted member-header__subtitle" role="status">
                You are on a guest session tied to this browser.{" "}
                <Link href="/login" className="member-header__inline-link">
                  Sign in
                </Link>{" "}
                to keep history if you clear cookies or switch devices.
              </p>
            ) : null}
          </div>

          {error && (
            <p className="chat-error" role="alert">{error}</p>
          )}

          <div className={`member-layout ${selectedConversation ? "member-layout--with-detail" : ""}`}>
          {/* Conversation list */}
          <section className="member-conv-list" aria-label="Conversations">
            {isLoadingConvs ? (
              <div className="member-loading" aria-label="Loading conversations">
                <div className="member-loading__spinner" aria-hidden="true" />
                <p className="member-loading__text">Loading conversations…</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="member-empty">
                <p className="member-empty__text">No conversations yet.</p>
                <Link href="/chat" className="ds-button ds-button--primary member-empty__cta">
                  Start a conversation
                </Link>
              </div>
            ) : (
              <ul className="conversation-list" aria-label="Conversation history list">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <button
                      type="button"
                      className={`conversation-item member-conv-item ${
                        selectedConversation?.id === conv.id ? "member-conv-item--active" : ""
                      }`}
                      onClick={() => setSelectedConversation(conv)}
                      aria-pressed={selectedConversation?.id === conv.id}
                    >
                      <span className="member-conv-item__title">{conv.title}</span>
                      <span className="member-conv-item__meta">
                        {formatDate(conv.createdAt)}
                        {conv.messageCount ? ` · ${conv.messageCount} messages` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Message detail panel */}
          {selectedConversation && (
            <section className="member-detail ds-panel" aria-label="Conversation messages">
              <div className="member-detail__header">
                <h2 className="member-detail__title">{selectedConversation.title}</h2>
                <button
                  type="button"
                  className="document-preview__close--icon ds-button"
                  onClick={() => { setSelectedConversation(null); setMessages([]); }}
                  aria-label="Close conversation"
                >
                  ✕
                </button>
              </div>

              {isLoadingMessages ? (
                <div className="member-loading" aria-label="Loading messages">
                  <div className="member-loading__spinner" aria-hidden="true" />
                  <p className="member-loading__text">Loading messages…</p>
                </div>
              ) : messages.length === 0 ? (
                <p className="member-empty__text">No messages in this conversation.</p>
              ) : (
                <div className="member-messages" role="log">
                  {messages.some((m) => m.role === "user") &&
                  !messages.some(
                    (m) => m.role === "assistant" && (m.content?.trim()?.length ?? 0) > 0
                  ) ? (
                    <p className="member-detail__missing-reply ds-text-muted" role="status">
                      No assistant reply is stored for this conversation (often due to an older save
                      bug). New questions you ask in Chat are saved with the full answer. Try asking
                      this topic again in Chat to capture the response here.
                    </p>
                  ) : null}
                  {messages.map((msg) => (
                    <ChatMessageBubble
                      key={msg.id}
                      message={{
                        id: msg.id,
                        role: msg.role,
                        content: msg.content,
                        sources: msg.sources ?? []
                      }}
                      onCitationSelect={(c) => {
                        setActiveCitation(c);
                      }}
                      activeCitation={activeCitation}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
          </div>
        </div>

        {activeCitation ? (
          <DocumentPreview citation={activeCitation} onClose={() => setActiveCitation(null)} />
        ) : null}
      </main>
    </div>
  );
}
