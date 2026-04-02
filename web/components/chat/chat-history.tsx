import { useEffect, useRef, useState, type RefObject } from "react";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";
import MobileHomePanel from "../home/mobile-home-panel";
import ChatMessageBubble from "./chat-message";

interface ChatHistoryProps {
  messages: ChatMessage[];
  onCitationSelect?: (citation: SourceExcerpt) => void;
  activeCitation?: SourceExcerpt | null;
  onPromptSelect?: (prompt: string) => void;
  onPromptSubmit?: (prompt: string) => void;
  scrollContainerRef?: RefObject<HTMLElement>;
  onScrollContainer?: () => void;
}

const SUGGESTED_PROMPTS = [
  "Who is the appointing authority for a 15-6 investigation?",
  "What are the steps to request leave?",
  "When can a commander suspend a religious beard accommodation?",
  "What is the timeline to flag a Soldier after adverse action starts?",
  "Can a Soldier take ordinary leave while under investigation?",
  "Who can initiate a FLIPL and what are the deadlines?",
  "What regulation covers corrective training and what are the limits?",
  "What are the requirements for a lawful order under Army regulations?",
  "What are the rules for shaving profiles and religious accommodations?",
];

const DISPLAYED_PROMPT_COUNT = 3;
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

function getRandomPrompts(prompts: string[], count: number) {
  const shuffled = [...prompts];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export default function ChatHistory({
  messages,
  onCitationSelect,
  activeCitation,
  onPromptSelect,
  onPromptSubmit,
  scrollContainerRef,
  onScrollContainer
}: ChatHistoryProps) {
  const [displayedPrompts, setDisplayedPrompts] = useState(() =>
    getRandomPrompts(SUGGESTED_PROMPTS, DISPLAYED_PROMPT_COUNT)
  );
  const [mobilePrompt, setMobilePrompt] = useState("");
  const previousMessageCountRef = useRef(messages.length);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;

    if (messages.length === 0 && previousMessageCount > 0) {
      setDisplayedPrompts(getRandomPrompts(SUGGESTED_PROMPTS, DISPLAYED_PROMPT_COUNT));
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
        <div className="chat-empty-state-mobile">
          <MobileHomePanel
            mode="chat"
            value={mobilePrompt}
            canSubmit={Boolean(onPromptSubmit)}
            onChange={setMobilePrompt}
            onSubmit={() => {
              if (!mobilePrompt.trim()) return;
              onPromptSubmit?.(mobilePrompt.trim());
            }}
            topics={[...MOBILE_HOME_TOPICS]}
          />
        </div>
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
            {displayedPrompts.map((prompt) => (
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
