"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { streamJagChatResponse, type BackendMessage, type ChatMessage, mergeSources, type SourceExcerpt } from "../../lib/jag-chat";
import { createConversation, saveMessage } from "../../lib/firestore-actions";
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
const PENDING_PROMPT_STORAGE_KEY = "armyregs:pending-mobile-prompt";

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

type ChatShellProps = {
  regulationSyncLabel?: string;
};

export default function ChatShell({ regulationSyncLabel }: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    // Intentionally start empty so the first row appears only after user sends a question.
  ]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<SourceExcerpt | null>(null);
  const [isCitationDrawerOpen, setIsCitationDrawerOpen] = useState(false);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const streamBufferRef = useRef("");
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  /** Full assistant text from the stream (persist before chunked UI reveal finishes). */
  const assistantPersistContentRef = useRef("");
  const assistantPersistSourcesRef = useRef<SourceExcerpt[]>([]);
  const chatScrollContainerRef = useRef<HTMLElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const chatFooterRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const assistantIndexRef = useRef<number | null>(null);
  const shouldFinishRevealRef = useRef(false);
  const hasConsumedPendingPromptRef = useRef(false);
  const hasFocusedTextEntryRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingSubmitJumpRef = useRef(false);
  // Persists the Firestore conversation ID for the current chat session.
  const conversationIdRef = useRef<string | null>(null);
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

  const stopStreamingReveal = useCallback(() => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = "";
    assistantIndexRef.current = null;
    shouldFinishRevealRef.current = false;
  }, []);

  const cancelScheduledScroll = useCallback(() => {
    if (scrollAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
  }, []);

  const scrollChatToBottom = useCallback(() => {
    const container = chatScrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const getAutoScrollThreshold = useCallback(() => {
    const footerHeight = chatFooterRef.current?.offsetHeight ?? 0;
    return Math.max(64, footerHeight + 24);
  }, []);

  const scheduleChatToBottom = useCallback(() => {
    if (!shouldAutoScrollRef.current) return;
    if (scrollAnimationFrameRef.current !== null) return;
    scrollAnimationFrameRef.current = requestAnimationFrame(() => {
      scrollAnimationFrameRef.current = null;
      scrollChatToBottom();
    });
  }, [scrollChatToBottom]);

  const handleClearChat = useCallback(() => {
    stopStreamingReveal();
    cancelScheduledScroll();
    setMessages([]);
    setErrorMessage(null);
    setInput("");
    setActiveCitation(null);
    setIsCitationDrawerOpen(false);
    setIsPreviewFullscreen(false);
    shouldAutoScrollRef.current = true;
    conversationIdRef.current = null;
    requestAnimationFrame(() => {
      const container = chatScrollContainerRef.current;
      if (container) {
        container.scrollTop = 0;
      }
    });
  }, [cancelScheduledScroll, stopStreamingReveal]);

  useEffect(() => {
    const handleNewTopic = () => {
      handleClearChat();
    };

    window.addEventListener("jag:new-topic", handleNewTopic as EventListener);
    return () => {
      window.removeEventListener("jag:new-topic", handleNewTopic as EventListener);
    };
  }, [handleClearChat]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewport = () => setViewportWidth(window.innerWidth);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const rootStyle = document.documentElement.style;
    const visualViewport = window.visualViewport;
    let viewportSyncFrameId: number | null = null;
    let viewportSyncBurstUntil = 0;

    const isTextEntryTarget = (target: EventTarget | null) =>
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    const pinDocumentScrollToTop = () => {
      const pageScroller = document.scrollingElement;
      if (pageScroller && pageScroller.scrollTop !== 0) {
        pageScroller.scrollTop = 0;
      }
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const restoreLayoutViewportHeight = () => {
      rootStyle.setProperty("--chat-viewport-offset-bottom", "0px");
      rootStyle.setProperty(
        "--chat-visual-viewport-height",
        `${Math.round(window.innerHeight)}px`
      );
      pinDocumentScrollToTop();
    };

    const syncVisualViewport = () => {
      const isMobileViewport = window.innerWidth <= 1024;
      const visualViewport = window.visualViewport;

      if (!isMobileViewport || !visualViewport) {
        restoreLayoutViewportHeight();
        return;
      }

      if (!hasFocusedTextEntryRef.current) {
        restoreLayoutViewportHeight();
        return;
      }

      const layoutViewportHeight = Math.round(window.innerHeight);
      const viewportPageTop =
        typeof visualViewport.pageTop === "number"
          ? visualViewport.pageTop
          : visualViewport.offsetTop;
      const viewportTopInset = Math.max(
        0,
        Math.round(visualViewport.offsetTop),
        Math.round(viewportPageTop - window.scrollY)
      );
      const effectiveVisibleHeight = Math.max(
        0,
        Math.min(
          layoutViewportHeight,
          Math.round(visualViewport.height + viewportTopInset)
        )
      );
      const rawHiddenBottomInset = Math.max(
        0,
        layoutViewportHeight - effectiveVisibleHeight
      );
      const cappedHiddenBottomInset = Math.min(
        rawHiddenBottomInset,
        Math.round(layoutViewportHeight * 0.18)
      );

      rootStyle.setProperty("--chat-viewport-offset-bottom", `${cappedHiddenBottomInset}px`);
      rootStyle.setProperty(
        "--chat-visual-viewport-height",
        `${effectiveVisibleHeight}px`
      );
      pinDocumentScrollToTop();
    };

    const runViewportSyncBurst = () => {
      syncVisualViewport();

      if (performance.now() >= viewportSyncBurstUntil) {
        viewportSyncFrameId = null;
        return;
      }

      viewportSyncFrameId = window.requestAnimationFrame(runViewportSyncBurst);
    };

    const scheduleViewportSync = (durationMs = 320) => {
      viewportSyncBurstUntil = Math.max(
        viewportSyncBurstUntil,
        performance.now() + durationMs
      );

      syncVisualViewport();

      if (viewportSyncFrameId === null) {
        viewportSyncFrameId = window.requestAnimationFrame(runViewportSyncBurst);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTextEntryTarget(event.target)) return;
      hasFocusedTextEntryRef.current = true;
      scheduleViewportSync(420);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isTextEntryTarget(event.relatedTarget)) return;
      if (isTextEntryTarget(document.activeElement)) return;

      hasFocusedTextEntryRef.current = false;
      restoreLayoutViewportHeight();
      scheduleViewportSync(420);
    };

    const handleWindowResize = () => {
      scheduleViewportSync(240);
    };

    const handleOrientationChange = () => {
      scheduleViewportSync(420);
    };

    const handleVisualViewportResize = () => {
      scheduleViewportSync(240);
    };

    const handleVisualViewportScroll = () => {
      scheduleViewportSync(240);
    };

    hasFocusedTextEntryRef.current = isTextEntryTarget(document.activeElement);
    scheduleViewportSync(420);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    visualViewport?.addEventListener("resize", handleVisualViewportResize);
    visualViewport?.addEventListener("scroll", handleVisualViewportScroll);

    return () => {
      if (viewportSyncFrameId !== null) {
        window.cancelAnimationFrame(viewportSyncFrameId);
      }
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      visualViewport?.removeEventListener("resize", handleVisualViewportResize);
      visualViewport?.removeEventListener("scroll", handleVisualViewportScroll);
      rootStyle.removeProperty("--chat-viewport-offset-bottom");
      rootStyle.removeProperty("--chat-visual-viewport-height");
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const container = chatScrollContainerRef.current;
    const content = chatContentRef.current;
    const footer = chatFooterRef.current;
    if (!container || !content) return;

    let resizeObserver: ResizeObserver | null = null;

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => {
        const footerHeight = footer?.offsetHeight ?? 0;
        container.style.setProperty("--chat-footer-overlay-height", `${footerHeight}px`);
        if (!shouldAutoScrollRef.current) return;
        scheduleChatToBottom();
      });

      resizeObserver.observe(container);
      resizeObserver.observe(content);
      if (footer) {
        resizeObserver.observe(footer);
      }
    }

    const footerHeight = footer?.offsetHeight ?? 0;
    container.style.setProperty("--chat-footer-overlay-height", `${footerHeight}px`);
    if (shouldAutoScrollRef.current) {
      scheduleChatToBottom();
    }

    return () => {
      resizeObserver?.disconnect();
      container.style.removeProperty("--chat-footer-overlay-height");
    };
  }, [messages.length, scheduleChatToBottom]);

  const updateAutoScrollIntent = useCallback(() => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    const bottomOffset =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = bottomOffset <= getAutoScrollThreshold();
  }, [getAutoScrollThreshold]);

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

  useLayoutEffect(() => {
    if (messages.length === 0) {
      const container = chatScrollContainerRef.current;
      if (container) {
        container.scrollTop = 0;
      }
      return;
    }

    if (pendingSubmitJumpRef.current) {
      pendingSubmitJumpRef.current = false;
      scrollChatToBottom();
      return;
    }

    if (shouldAutoScrollRef.current) {
      scheduleChatToBottom();
    }
  }, [isSubmitting, messages, scheduleChatToBottom, scrollChatToBottom]);

  /**
   * Persists a completed message pair (user + assistant) to Firestore.
   * Runs best-effort after streaming completes — errors are logged but do
   * not surface to the user since persistence is non-critical to the chat UX.
   */
  const persistMessages = useCallback(async (
    uid: string,
    userText: string,
    assistantMessage: ChatMessage
  ) => {
    try {
      if (!conversationIdRef.current) {
        conversationIdRef.current = await createConversation(uid, userText);
      }
      const convId = conversationIdRef.current;
      await saveMessage(uid, convId, { role: "user", content: userText, sources: [] });
      await saveMessage(uid, convId, {
        role: "assistant",
        content: assistantMessage.content,
        sources: assistantMessage.sources
      });
    } catch (err) {
      console.error("[ChatShell] Failed to persist messages:", err);
    }
  }, []);

  const submitPrompt = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isSubmitting || (auth.hasConfig && !auth.isReady)) return;

    const userMessage = createMessage("user", text);
    const assistantMessage = createMessage("assistant", "", true);
    const assistantIndex = messages.length + 1;

    assistantPersistContentRef.current = "";
    assistantPersistSourcesRef.current = [];

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput((current) => (current.trim() === text ? "" : current));
    setErrorMessage(null);
    setIsSubmitting(true);
    stopStreamingReveal();
    cancelScheduledScroll();
    shouldAutoScrollRef.current = true;
    assistantIndexRef.current = assistantIndex;
    pendingSubmitJumpRef.current = true;

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
            assistantPersistContentRef.current += token;
            streamBufferRef.current += token;

            if (assistantIndexRef.current === null) {
              assistantIndexRef.current = assistantIndex;
            }

            if (streamTimerRef.current === null) {
              scheduleStreamChunk(assistantIndex);
            }
          },
          onSources: (incomingSources: SourceExcerpt[]) => {
            assistantPersistSourcesRef.current = mergeSources(
              assistantPersistSourcesRef.current,
              incomingSources
            );
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

      if (auth.user) {
        const content = assistantPersistContentRef.current;
        const assistantForPersist: ChatMessage = {
          ...assistantMessage,
          content: content.trim() || "(No response text was returned.)",
          isStreaming: false,
          sources: [...assistantPersistSourcesRef.current]
        };
        void persistMessages(auth.user.uid, text, assistantForPersist);
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
            isStreaming: false
          };
        })
      );
    } finally {
      setIsSubmitting(false);
      if (shouldAutoScrollRef.current) {
        scheduleChatToBottom();
      }
    }
  }, [auth.hasConfig, auth.idToken, auth.isReady, auth.user, cancelScheduledScroll, conversationForBackend, isSubmitting, messages.length, persistMessages, scheduleChatToBottom, stopStreamingReveal]);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    await submitPrompt(input);
  };

  useEffect(() => {
    return () => {
      cancelScheduledScroll();
    };
  }, [cancelScheduledScroll]);

  useEffect(() => {
    if (typeof window === "undefined" || hasConsumedPendingPromptRef.current) return;
    if (messages.length > 0 || isSubmitting || auth.isLoading || !auth.user) return;
    if (auth.hasConfig && !auth.isReady) return;

    const pendingPrompt = sessionStorage.getItem(PENDING_PROMPT_STORAGE_KEY)?.trim();
    if (!pendingPrompt) return;

    hasConsumedPendingPromptRef.current = true;
    sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY);
    void submitPrompt(pendingPrompt);
  }, [auth.hasConfig, auth.isLoading, auth.isReady, auth.user, isSubmitting, messages.length, submitPrompt]);

  const isCompactPreviewViewport = viewportWidth !== null && viewportWidth <= 1080;
  const showInlinePreview = isCitationDrawerOpen && !isCompactPreviewViewport && !isPreviewFullscreen;
  const showOverlayPreview = isCitationDrawerOpen && (isCompactPreviewViewport || isPreviewFullscreen);
  return (
    <main className={`workspace-shell workspace-shell--chat ${showInlinePreview ? "workspace-shell--with-drawer" : ""}`}>
      <section className={`chat-root${errorMessage ? " chat-root--has-error" : ""}`}>
        <Panel
          as="section"
          className={`chat-shell${messages.length === 0 ? " chat-shell--empty" : ""}${errorMessage ? " chat-shell--has-error" : ""}`}
        >
          {messages.length > 0 ? (
            <div className="chat-shell__controls">
              <h2 className="chat-shell__title">Army Regulation Assistant</h2>
              <Button
                type="button"
                variant="ghost"
                className="chat-shell__clear-button"
                onClick={handleClearChat}
              >
                New Topic
              </Button>
            </div>
          ) : null}

          <ChatHistory
            messages={messages}
            regulationSyncLabel={regulationSyncLabel}
            onCitationSelect={(source) => {
              setActiveCitation(source);
              setIsCitationDrawerOpen(true);
              setIsPreviewFullscreen(false);
            }}
            activeCitation={activeCitation}
            onPromptSubmit={(prompt) => {
              setInput(prompt);
              void submitPrompt(prompt);
            }}
            scrollContainerRef={chatScrollContainerRef}
            contentRef={chatContentRef}
            endRef={endRef}
            onScrollContainer={updateAutoScrollIntent}
          />

          <div ref={chatFooterRef} className="chat-shell__footer">
            {errorMessage ? (
              <p className="chat-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <ChatComposer
              value={input}
              isSubmitting={isSubmitting}
              canSend={canSend}
              onChange={setInput}
              onSubmit={() => handleSubmit()}
            />
          </div>
        </Panel>
      </section>

      {showInlinePreview ? (
        <DocumentPreview
          citation={activeCitation}
          onClose={() => {
            setIsCitationDrawerOpen(false);
            setIsPreviewFullscreen(false);
          }}
          onToggleFullscreen={() => setIsPreviewFullscreen(true)}
        />
      ) : null}

      {showOverlayPreview && typeof document !== "undefined"
        ? createPortal(
            <div className="chat-preview-modal" aria-label="Source verification overlay">
              <DocumentPreview
                citation={activeCitation}
                isOverlay
                onClose={() => {
                  setIsCitationDrawerOpen(false);
                  setIsPreviewFullscreen(false);
                }}
                onToggleFullscreen={
                  !isCompactPreviewViewport ? () => setIsPreviewFullscreen((current) => !current) : undefined
                }
                isFullscreen={isPreviewFullscreen}
              />
            </div>,
            document.body
          )
        : null}
    </main>
  );
}
