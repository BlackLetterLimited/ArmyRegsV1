import type { RefObject } from "react";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";
import ChatMessageBubble from "./chat-message";

interface ChatHistoryProps {
  messages: ChatMessage[];
  onCitationSelect?: (citation: SourceExcerpt) => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onScrollContainer?: () => void;
}

export default function ChatHistory({
  messages,
  onCitationSelect,
  scrollContainerRef,
  onScrollContainer
}: ChatHistoryProps) {
  if (messages.length === 0) {
    return (
      <section
        ref={scrollContainerRef}
        className="chat-messages chat-messages--empty"
        role="log"
        aria-live="polite"
        onScroll={onScrollContainer}
      >
        <div className="chat-empty-state">
          <h2 className="chat-empty-state__title">WELCOME TO ARMYREGS.AI</h2>
          <p className="chat-empty-state__body">
            This tool allows you to ask questions to a library of Army Regulations. It will
            provide highly accurate answers with citations to specific regulations and paragraph
            numbers which you can verify in the column on the right.
          </p>
          <p className="chat-empty-state__body">
            You can ask questions like "What are the steps to request leave?" or "Who is the
            appoining authority for a 15-6 investigation?"
          </p>
        </div>
        <aside className="chat-empty-disclaimer" aria-label="Usage warning">
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
      {messages.map((message) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          onCitationSelect={onCitationSelect}
        />
      ))}
    </section>
  );
}
