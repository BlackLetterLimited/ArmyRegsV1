import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "../ui/button";

interface ChatComposerProps {
  className?: string;
  ariaLabel?: string;
  value: string;
  isSubmitting: boolean;
  canSend: boolean;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  placeholder?: string;
}

export default function ChatComposer({
  className = "",
  ariaLabel = "Ask an Army regulation question",
  value,
  isSubmitting,
  canSend,
  onChange,
  onSubmit,
  placeholder = "Ask your question."
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isTextareaReadOnly = !canSend || isSubmitting;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [value]);

  const handleChange = (nextValue: string) => {
    if (isTextareaReadOnly) return;
    onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isTextareaReadOnly) return;
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      className={["chat-composer", className].filter(Boolean).join(" ")}
      aria-disabled={isTextareaReadOnly}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        className="chat-composer__textarea"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder}
        readOnly={isTextareaReadOnly}
        aria-disabled={isTextareaReadOnly}
        aria-label={ariaLabel}
      />
      <Button
        className="chat-composer__send"
        type="submit"
        aria-label={isSubmitting ? "Sending message" : "Send message"}
        disabled={!canSend || isSubmitting || !value.trim()}
      >
        <span aria-hidden="true">{isSubmitting ? "..." : "↑"}</span>
      </Button>
    </form>
  );
}
