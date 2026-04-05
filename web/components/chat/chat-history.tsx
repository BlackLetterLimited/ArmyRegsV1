import Image from "next/image";
import type { RefObject } from "react";
import logo from "../../logo.png";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";
import ChatComposer from "./chat-composer";
import ChatMessageBubble from "./chat-message";

interface ChatHistoryProps {
  messages: ChatMessage[];
  input: string;
  isSubmitting: boolean;
  canSend: boolean;
  regulationSyncLabel?: string;
  onInputChange: (value: string) => void;
  onCitationSelect?: (citation: SourceExcerpt) => void;
  activeCitation?: SourceExcerpt | null;
  onPromptSubmit?: (prompt: string) => void;
  scrollContainerRef?: RefObject<HTMLElement>;
  contentRef?: RefObject<HTMLDivElement>;
  endRef?: RefObject<HTMLDivElement>;
  onScrollContainer?: () => void;
}

type ChatHomeTopic = {
  label: string;
  chipLabel: string;
  prompt: string;
};

const CHAT_HOME_TOPICS: ChatHomeTopic[] = [
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
];

export default function ChatHistory({
  messages,
  input,
  isSubmitting,
  canSend,
  regulationSyncLabel,
  onInputChange,
  onCitationSelect,
  activeCitation,
  onPromptSubmit,
  scrollContainerRef,
  contentRef,
  endRef,
  onScrollContainer
}: ChatHistoryProps) {
  if (messages.length === 0) {
    const trimmedInput = input.trim();

    return (
      <section
        ref={scrollContainerRef}
        className="chat-messages chat-messages--empty"
        role="log"
        aria-live="polite"
        onScroll={onScrollContainer}
      >
        <div ref={contentRef} className="chat-messages__content chat-messages__content--empty">
          <div className="chat-home" aria-label="Start a new Army regulation search">
            <div className="chat-home__hero">
              <div className="chat-home__logo-wrap">
                <Image
                  src={logo}
                  alt="ArmyRegs.ai"
                  width={1093}
                  height={253}
                  className="chat-home__logo"
                  sizes="(max-width: 768px) 82vw, 560px"
                />
              </div>

              <ChatComposer
                className="chat-composer--hero"
                ariaLabel="Search Army regulations"
                value={input}
                isSubmitting={isSubmitting}
                canSend={canSend}
                onChange={onInputChange}
                onSubmit={async () => {
                  if (!trimmedInput) return;
                  onPromptSubmit?.(trimmedInput);
                }}
                placeholder="Search Army regulations..."
              />

              <div className="chat-home__chips-frame">
                <div className="mobile-home__chips-lead chat-home__chips-lead">
                  <p className="mobile-home__chips-eyebrow">Example Questions</p>
                </div>

                <div className="chat-home__chips-marquee" aria-label="Example questions">
                  <div className="mobile-home__chips chat-home__chips">
                    {[...CHAT_HOME_TOPICS, ...CHAT_HOME_TOPICS].map((topic, index) => (
                      <button
                        key={`${topic.label}-${index}`}
                        type="button"
                        className="mobile-home__chip chat-home__chip"
                        onClick={() => onPromptSubmit?.(topic.prompt)}
                        disabled={!canSend || isSubmitting}
                        aria-hidden={index >= CHAT_HOME_TOPICS.length}
                        tabIndex={index >= CHAT_HOME_TOPICS.length ? -1 : 0}
                      >
                        {topic.chipLabel ?? topic.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <aside
                className="chat-empty-disclaimer chat-empty-disclaimer--home"
                aria-label="Usage notice"
              >
                <h2 className="chat-empty-disclaimer__title">Notice</h2>
                <p className="chat-empty-disclaimer__text">
                  Do not include any Personally Identifying Information (PII), HIPAA Protected Health
                  Information (PHI), or classified (including CUI) information.
                </p>
                <p className="chat-empty-disclaimer__text">
                  This tool does not constitute legal advice and should not be used as a substitute
                  for consulting the actual regulations or a legal professional. Always verify the
                  information provided by this tool against the official Army Regulations and consult
                  with a qualified legal advisor for any specific questions or concerns.
                </p>
              </aside>

              {regulationSyncLabel ? (
                <p className="chat-home__notice-meta">Last regulation sync: {regulationSyncLabel}</p>
              ) : null}

              <p className="chat-home__copyright">&copy; 2026 Blackletter Limited. All rights reserved.</p>
            </div>
          </div>

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
