"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TopicItem = {
  label: string;
  prompt: string;
  chipLabel?: string;
};

interface MobileHomePanelProps {
  mode: "landing" | "chat";
  value: string;
  isSubmitting?: boolean;
  submitLabel?: string;
  canSubmit: boolean;
  showSearch?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  topics: TopicItem[];
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-home__icon-svg">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-home__icon-svg">
      <path
        d="M5 12h14m-5-5 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TopicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-home__row-icon">
      <path
        d="M5 7h14M5 12h14M5 17h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-home__row-chevron">
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shuffleTopics(items: TopicItem[]) {
  const nextTopics = [...items];
  for (let index = nextTopics.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [nextTopics[index], nextTopics[randomIndex]] = [nextTopics[randomIndex], nextTopics[index]];
  }
  return nextTopics;
}

export default function MobileHomePanel({
  mode,
  value,
  isSubmitting = false,
  submitLabel = "Continue",
  canSubmit,
  showSearch = true,
  onChange,
  onSubmit,
  topics
}: MobileHomePanelProps) {
  const [isLearnMoreOpen, setIsLearnMoreOpen] = useState(false);
  const topicsSignature = useMemo(
    () => topics.map((topic) => `${topic.label}|${topic.prompt}|${topic.chipLabel ?? ""}`).join("::"),
    [topics]
  );
  const [shuffledTopics, setShuffledTopics] = useState(() => shuffleTopics(topics));
  const introId = `${mode}-mobile-home-intro`;
  const learnMoreId = `${mode}-mobile-home-more`;

  useEffect(() => {
    setShuffledTopics(shuffleTopics(topics));
  }, [topicsSignature]);

  return (
    <section className="mobile-home" aria-labelledby={introId}>
      {showSearch ? (
        <>
          <div className="mobile-home__search-lead">
            <p className="mobile-home__search-eyebrow">Search Army Regs with AI</p>
          </div>

          <form
            className="mobile-home__search"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <span className="mobile-home__search-icon">
              <SearchIcon />
            </span>
            <div className="mobile-home__search-input-wrap">
              {!value ? (
                <span className="mobile-home__search-placeholder" aria-hidden="true">
                  Ask your question...
                </span>
              ) : null}
              <input
                className="mobile-home__search-input"
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder=""
                aria-label="Ask an Army regulation question"
              />
            </div>
            <button
              type="submit"
              className="mobile-home__search-submit"
              disabled={!canSubmit || isSubmitting || !value.trim()}
              aria-label={isSubmitting ? "Submitting question" : submitLabel}
            >
              <ArrowIcon />
            </button>
          </form>

          <div className="mobile-home__chips-lead">
            <p className="mobile-home__chips-eyebrow">Example Questions</p>
          </div>

          <div className="mobile-home__chips" aria-label="Quick topics">
            {shuffledTopics.map((topic) => (
              <button
                key={topic.label}
                type="button"
                className="mobile-home__chip"
                onClick={() => onChange(topic.prompt)}
              >
                {topic.chipLabel ?? topic.label}
              </button>
            ))}
          </div>

          <div className="mobile-home__divider" aria-hidden="true" />
        </>
      ) : null}

      <article className="mobile-home__intro-card">
        <h1 className="mobile-home__intro-title" id={introId}>
          <span className="mobile-home__intro-title-line">Welcome to ArmyRegs.ai!</span>
          <span className="mobile-home__intro-title-line">
            AI Army regulation research with precise, verifiable citations.
          </span>
        </h1>
        <p className="mobile-home__intro-body">
          Ask plain-language questions.
        </p>
        <p className="mobile-home__intro-body mobile-home__intro-body--secondary">
          Get AI-generated answers tied to exact regulation paragraphs, then open the source PDF to inspect the text in context.
        </p>
        <button
          type="button"
          className="mobile-home__learn-more"
          aria-expanded={isLearnMoreOpen}
          aria-controls={learnMoreId}
          onClick={() => setIsLearnMoreOpen((current) => !current)}
        >
          <span>Learn More</span>
          <span className={`mobile-home__learn-more-chevron${isLearnMoreOpen ? " is-open" : ""}`}>
            <ChevronIcon />
          </span>
        </button>
        {isLearnMoreOpen ? (
          <div className="mobile-home__learn-more-content" id={learnMoreId}>
            <p className="mobile-home__learn-more-block">
              <strong>Built for research:</strong> ArmyRegs.ai helps Soldiers, leaders, and legal professionals find and understand Army regulations faster.
            </p>
            <p className="mobile-home__learn-more-block">
              <strong>Citation-backed answers:</strong> each response includes source citations so you can trace the answer back to the underlying authority.
            </p>
            <p className="mobile-home__learn-more-block">
              <strong>Open the source:</strong> click a citation to view the regulation PDF and review the quoted passage in context.
            </p>
            {mode === "landing" ? (
              <p className="mobile-home__learn-more-block">
                <strong>Save your work:</strong> <Link href="/signup">Create an account</Link> to keep research history across devices.
              </p>
            ) : null}
          </div>
        ) : null}
      </article>

      {mode === "chat" ? (
        <>
          <div className="mobile-home__divider" aria-hidden="true" />

          <aside className="chat-empty-disclaimer mobile-home__notice-card" aria-label="Usage notice">
            <h2 className="chat-empty-disclaimer__title">Notice</h2>
            <p className="chat-empty-disclaimer__text">
              Do not include any Personally Identifying Information (PII), HIPAA Protected Health Information (PHI), or classified (including CUI) information.
            </p>
            <p className="chat-empty-disclaimer__text">
              This tool does not constitute legal advice and should not be used as a substitute for consulting the actual regulations or a legal professional. Always verify the information provided by this tool against the official Army Regulations and consult with a qualified legal advisor for any specific questions or concerns.
            </p>
          </aside>
        </>
      ) : null}
    </section>
  );
}
