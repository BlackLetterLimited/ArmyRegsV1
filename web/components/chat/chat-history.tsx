import type { RefObject } from "react";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";
import ChatMessageBubble from "./chat-message";

interface ChatHistoryProps {
  messages: ChatMessage[];
  onCitationSelect?: (citation: SourceExcerpt) => void;
  activeCitation?: SourceExcerpt | null;
  onPromptSelect?: (prompt: string) => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onScrollContainer?: () => void;
}

const SUGGESTED_PROMPTS = [
  "Who is the appointing authority for a 15-6 investigation?",
  "What are the steps to request leave?",
  "When can a commander suspend a religious beard accommodation?"
];

export default function ChatHistory({
  messages,
  onCitationSelect,
  activeCitation,
  onPromptSelect,
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
          <h2 className="chat-empty-state__title">Welcome to ArmyRegs.ai</h2>
          <p className="chat-empty-state__body">
            ArmyRegs.ai helps you quickly research Army regulations by turning plain-language
            questions into structured answers tied to specific regulatory sources. Each response is
            grounded in cited paragraphs so you can trace the reasoning, verify the underlying
            authority, and move faster from question to actionable guidance.
          </p>
          <p className="chat-empty-state__cta">
            Pick a prompt or ask your own.
          </p>
          <div className="chat-empty-state__prompts" aria-label="Suggested prompts">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chat-empty-state__prompt-chip"
                onClick={() => onPromptSelect?.(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
        <aside className="chat-empty-disclaimer" aria-label="Usage warning">
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
          activeCitation={activeCitation}
        />
      ))}
    </section>
  );
}
