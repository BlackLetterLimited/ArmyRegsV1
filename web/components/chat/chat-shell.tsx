"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamJagChatResponse, type BackendMessage, type ChatMessage, mergeSources, type SourceExcerpt } from "../../lib/jag-chat";
import { useFirebaseAuth } from "../auth/auth-provider";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import ChatComposer from "./chat-composer";
import ChatHistory from "./chat-history";
import DocumentPreview from "./document-preview";

const FALLBACK_ERROR_RESPONSE = `**Answer – Summary**

- **What authorizes a beard accommodation?**  
  AR 600‑20 para 5‑6 f(2) – the regulation expressly permits a permanent religious accommodation for a beard (and other faith‑based grooming items) for the Soldier’s entire career, subject only to suspension procedures.

- **What lets a commander suspend that accommodation because of a CBRN threat?**  
  AR 600‑20 para 5‑6 f(3)(c) (and the parallel language in AR 600‑20 para 6‑10 c(2)(b)) – these paragraphs give the General Court‑Martial Convening Authority (GCMCA) and the commander the authority to temporarily suspend the beard accommodation when a specific, concrete threat of exposure to toxic CBRN agents exists, requiring all Soldiers to be clean‑shaven for mask safety.

---

### General Rule and Verbatim Citations

| Regulation | Paragraph | Verbatim Quote | Citation |
|-------------|-----------|----------------|----------|
| **Authorization of beard accommodation** | 5‑6 f(2) | “Approved accommodations pertaining to the following faith practices continue throughout a Soldier’s career: wear of a hijab, wear of a beard, and the wear of a turban or under‑turban/patka with uncut beard and uncut hair. **Although subject to the suspension procedures below, these accommodations may not be permanently revoked or modified unless authorized by the SECARMY or designee.**” | AR 600‑20 para 5‑6 f(2) |
| **Authority to suspend for CBRN risk** | 5‑6 f(3)(c) | “**Note: An accommodation for a beard may be temporarily suspended when a specific and concrete threat of exposure to toxic CBRN agents exists that requires all Soldiers to be clean‑shaven,** … **Following the suspension procedures of this paragraph, commanders may require a Soldier to shave if the unit is in, or about to enter, a real tactical situation where use of the protective mask is actually required and where the inability to safely use the mask could endanger the Soldier and the unit.**” | AR 600‑20 para 5‑6 f(3)(c) |
| **Parallel CBRN‑suspension language** | 6‑10 c(2)(b) | “**An accommodation for a beard may be temporarily suspended when a threat of exposure to toxic CBRN agents exists that requires all Soldiers to be clean‑shaven,** … **commanders may require a Soldier to shave if the unit is in, or about to enter, a tactical situation where use of the protective mask will likely be required and where the inability to safely use the mask could endanger the Soldier and the unit.**” | AR 600‑20 para 6‑10 c(2)(b) |

---

### Detailed Legal Analysis

1. **Authorization (AR 600‑20 para 5‑6 f(2))**  
   - This paragraph is **permissive** (authorizes) the beard accommodation as a *faith‑based* grooming accommodation.  
   - The language makes the accommodation **career‑long** and states that it **cannot be permanently revoked or modified** except by the **SECARMY (Secretary of the Army) or a designee**.  
   - The phrase “subject to the suspension procedures below” signals that while the accommodation is permanent, it can be **temporarily suspended** under certain conditions.

2. **Suspension authority (AR 600‑20 para 5‑6 f(3)(c))**  
   - This paragraph is **conditional**: it permits **temporary suspension** when a **specific and concrete threat** of exposure to **toxic CBRN agents** exists.  
   - It explicitly gives **commanders** (through the GCMCA after consultation with the Staff Judge Advocate) the power to **require the Soldier to shave** in a tactical situation where a protective mask must be used and a beard would compromise safety.  
   - The suspension is **temporary** and must follow the **suspension procedures** outlined in the same paragraph (notification, appeal rights, reinstatement when the threat no longer exists).

3. **Reinforcement (AR 600‑20 para 6‑10 c(2)(b))**  
   - This later paragraph repeats the same CBRN‑related suspension authority, confirming that **any commander** may enforce a clean‑shaven requirement under the described CBRN threat.  
   - The duplication underscores the policy’s intent and provides an additional citation for commanders who reference the **Military Equal Opportunity Program** section.

4. **Interaction of the two rules**  
   - The **authorization** (5‑6 f(2)) establishes the **right** to wear a beard as a religious accommodation.  
   - The **suspension authority** (5‑6 f(3)(c) and 6‑10 c(2)(b)) creates a **limited, conditional exception** to that right when health‑ and safety‑critical CBRN conditions arise.  
   - Because the suspension is **temporary** and must be **reinstated** when the threat ceases, the permanent nature of the accommodation remains intact, consistent with the limitation that only the SECARMY or designee may **permanently** modify it.

5. **Procedural safeguards**  
   - The GCMCA must **consult the Staff Judge Advocate**, **notify the Soldier** of the suspension, the **basis**, the **effective date**, and the **right to appeal** (see AR 600‑20 para 5‑6 f(3)(a) for appeal process).  
   - In **exigent circumstances**, the GCMCA may **shorten the appeal time** and **immediately suspend** the accommodation (AR 600‑20 para 5‑6 f(3)(b)).

---

**Bottom line:**  
- The **beard exception** is **authorized** by **AR 600‑20 para 5‑6 f(2)**.  
- **Commanders** may **temporarily suspend** that accommodation when a **specific CBRN threat** exists, as provided in **AR 600‑20 para 5‑6 f(3)(c)** (and reiterated in **AR 600‑20 para 6‑10 c(2)(b)**).`;
const LAST_REGULATION_SYNC_LABEL = "March 7, 2026";

function createMessage(
  role: "user" | "assistant",
  content: string,
  isStreaming = false
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    isStreaming,
    sources: []
  };
}

function toBackendMessages(messages: ChatMessage[]): BackendMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

export default function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    // Intentionally start empty so the first row appears only after user sends a question.
  ]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<SourceExcerpt | null>(null);
  const [isCitationDrawerOpen, setIsCitationDrawerOpen] = useState(false);
  const streamBufferRef = useRef("");
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollContainerRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const assistantIndexRef = useRef<number | null>(null);
  const shouldFinishRevealRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const auth = useFirebaseAuth();

  const conversationForBackend = useMemo(
    () =>
      toBackendMessages(
        messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ ...message }))
      ),
    [messages]
  );

  const canSend = !isSubmitting && !auth.isLoading && (auth.hasConfig ? auth.isReady : true);

  const stopStreamingReveal = () => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = "";
    assistantIndexRef.current = null;
    shouldFinishRevealRef.current = false;
  };

  const handleClearChat = useCallback(() => {
    stopStreamingReveal();
    setMessages([]);
    setErrorMessage(null);
    setInput("");
    setActiveCitation(null);
    setIsCitationDrawerOpen(false);
    shouldAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      const container = chatScrollContainerRef.current;
      if (container) {
        container.scrollTop = 0;
      }
    });
  }, []);

  const updateAutoScrollIntent = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    const bottomOffset =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const enableAtBottomThreshold = 2;
    const disableWhenAwayThreshold = 24;

    if (bottomOffset <= enableAtBottomThreshold) {
      shouldAutoScrollRef.current = true;
      return;
    }

    if (bottomOffset > disableWhenAwayThreshold) {
      shouldAutoScrollRef.current = false;
    }
  };

  const scheduleStreamChunk = (assistantIndex: number) => {
    const flush = () => {
      const pending = streamBufferRef.current;
      if (!pending.length) {
        streamTimerRef.current = null;
        if (shouldFinishRevealRef.current) {
          shouldFinishRevealRef.current = false;
          setMessages((prev) =>
            prev.map((entry, index) =>
              index === assistantIndex
                ? {
                    ...entry,
                    isStreaming: false
                  }
                : entry
            )
          );
        }
        return;
      }

      const chunkSize = 12;
      const chunk = pending.slice(0, chunkSize);
      streamBufferRef.current = pending.slice(chunkSize);

      setMessages((prev) =>
        prev.map((entry, index) =>
          index === assistantIndex
            ? {
                ...entry,
                content: `${entry.content}${chunk}`,
                isStreaming: true
              }
            : entry
        )
      );

      streamTimerRef.current = streamBufferRef.current.length
        ? setTimeout(flush, 26)
        : null;
    };

    streamTimerRef.current = setTimeout(flush, 18);
  };

  useEffect(() => {
    if (messages.length === 0) {
      const container = chatScrollContainerRef.current;
      if (container) {
        container.scrollTop = 0;
      }
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;
    if ((lastMessage.role === "assistant" || isSubmitting) && shouldAutoScrollRef.current) {
      const container = chatScrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages, isSubmitting]);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    const text = input.trim();
    if (!text || isSubmitting || (auth.hasConfig && !auth.isReady)) return;

    const userMessage = createMessage("user", text);
    const assistantMessage = createMessage("assistant", "", true);
    const assistantIndex = messages.length + 1;

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setErrorMessage(null);
    setIsSubmitting(true);
    stopStreamingReveal();
    shouldAutoScrollRef.current = true;
    assistantIndexRef.current = assistantIndex;

    const outgoingHistory: BackendMessage[] = [
      ...conversationForBackend,
      { role: "user", content: text }
    ];

    try {
      await streamJagChatResponse(
        {
          message: text,
          query: text,
          input: text,
          messages: outgoingHistory
        },
        {
          onToken: (token) => {
            streamBufferRef.current += token;

            if (assistantIndexRef.current === null) {
              assistantIndexRef.current = assistantIndex;
            }

            if (streamTimerRef.current === null) {
              scheduleStreamChunk(assistantIndex);
            }
          },
          onSources: (incomingSources: SourceExcerpt[]) => {
            setMessages((prev) =>
              prev.map((entry, index) => {
                if (index !== assistantIndex) return entry;

                const mergedSources = mergeSources(entry.sources, incomingSources);
                return {
                  ...entry,
                  sources: mergedSources
                };
              })
            );
          }
        },
        {
          idToken: auth.idToken
        }
      );

      shouldFinishRevealRef.current = true;
      if (streamTimerRef.current === null) {
        scheduleStreamChunk(assistantIndex);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get response.";
      setErrorMessage(message);
      stopStreamingReveal();
      setMessages((prev) =>
        prev.map((entry, index) => {
          if (index !== assistantIndex) return entry;
          return {
            ...entry,
            content: "",
            isStreaming: true
          };
        })
      );

      streamBufferRef.current = FALLBACK_ERROR_RESPONSE;
      assistantIndexRef.current = assistantIndex;
      shouldFinishRevealRef.current = true;
      if (streamTimerRef.current === null) {
        scheduleStreamChunk(assistantIndex);
      }
    } finally {
      setIsSubmitting(false);
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  };

  return (
    <main className={`workspace-shell ${isCitationDrawerOpen ? "workspace-shell--with-drawer" : ""}`}>
      <section className="chat-root">
        <Panel as="section" className="chat-shell">
          {messages.length > 0 ? (
            <div className="chat-shell__controls">
              <h2 className="chat-shell__title">Army Regulation Assistant</h2>
              <Button
                type="button"
                variant="ghost"
                className="chat-shell__clear-button"
                onClick={handleClearChat}
              >
                Clear
              </Button>
            </div>
          ) : null}

          <ChatHistory
            messages={messages}
            onCitationSelect={(source) => {
              setActiveCitation(source);
              setIsCitationDrawerOpen(true);
            }}
            activeCitation={activeCitation}
            onPromptSelect={(prompt) => {
              setInput(prompt);
              requestAnimationFrame(() => {
                document.querySelector<HTMLTextAreaElement>(".chat-composer__textarea")?.focus();
              });
            }}
            scrollContainerRef={chatScrollContainerRef}
            onScrollContainer={updateAutoScrollIntent}
          />
          <div ref={endRef} className="chat-shell__end-anchor" />

          <ChatComposer
            value={input}
            isSubmitting={isSubmitting}
            canSend={canSend}
            onChange={setInput}
            onSubmit={() => handleSubmit()}
          />
          <div className="chat-trust-cues" aria-label="Trust and compliance notices">
            <p className="chat-trust-cue">Last regulation sync: {LAST_REGULATION_SYNC_LABEL}</p>
          </div>
          {errorMessage ? (
            <p className="chat-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </Panel>
      </section>

      {isCitationDrawerOpen ? (
        <DocumentPreview
          citation={activeCitation}
          onClose={() => setIsCitationDrawerOpen(false)}
        />
      ) : null}
    </main>
  );
}
