import { useEffect, useRef, useState, type RefObject } from "react";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";
import MobileHomePanel from "../home/mobile-home-panel";
import ChatMessageBubble from "./chat-message";

interface ChatHistoryProps {
  messages: ChatMessage[];
  regulationSyncLabel?: string;
  onCitationSelect?: (citation: SourceExcerpt) => void;
  activeCitation?: SourceExcerpt | null;
  onPromptSubmit?: (prompt: string) => void;
  scrollContainerRef?: RefObject<HTMLElement>;
  contentRef?: RefObject<HTMLDivElement>;
  endRef?: RefObject<HTMLDivElement>;
  onScrollContainer?: () => void;
}
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
    chipLabel: "Who is the appointing authority for a 15-6 investigation?",
    prompt: "Who is the appointing authority for a 15-6 investigation?"
  }
] as const;

export default function ChatHistory({
  messages,
  regulationSyncLabel,
  onCitationSelect,
  activeCitation,
  onPromptSubmit,
  scrollContainerRef,
  contentRef,
  endRef,
  onScrollContainer
}: ChatHistoryProps) {
  const [mobilePrompt, setMobilePrompt] = useState("");
  const previousMessageCountRef = useRef(messages.length);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;

    if (messages.length === 0 && previousMessageCount > 0) {
      setMobilePrompt("");
    }

    previousMessageCountRef.current = messages.length;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <section
        ref={scrollContainerRef}
        className="chat-messages chat-messages--empty"
        role="log"
        aria-live="polite"
        onScroll={onScrollContainer}
      >
        <div ref={contentRef} className="chat-messages__content">
          <div className="chat-empty-state-mobile">
            <MobileHomePanel
              mode="chat"
              value={mobilePrompt}
              regulationSyncLabel={regulationSyncLabel}
              canSubmit={Boolean(onPromptSubmit)}
              onChange={setMobilePrompt}
              onSubmit={() => {
                if (!mobilePrompt.trim()) return;
                onPromptSubmit?.(mobilePrompt.trim());
              }}
              topics={[...MOBILE_HOME_TOPICS]}
            />
          </div>
          <aside
            className="chat-empty-disclaimer chat-empty-disclaimer--desktop"
            aria-label="Usage warning"
          >
            <h3 className="chat-empty-disclaimer__title">Notice</h3>
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
          <div ref={endRef} className="chat-shell__end-anchor" aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <section
      ref={scrollContainerRef}
      className="chat-messages"
      role="log"
      aria-live="polite"
      onScroll={onScrollContainer}
    >
      <div ref={contentRef} className="chat-messages__content">
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id}
            message={message}
            onCitationSelect={onCitationSelect}
            activeCitation={activeCitation}
          />
        ))}
        <div ref={endRef} className="chat-shell__end-anchor" aria-hidden="true" />
      </div>
    </section>
  );
}
