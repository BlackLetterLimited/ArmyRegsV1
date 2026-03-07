import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "../ui/button";

interface ChatComposerProps {
  value: string;
  isSubmitting: boolean;
  canSend: boolean;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
}

export default function ChatComposer({
  value,
  isSubmitting,
  canSend,
  onChange,
  onSubmit
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [value]);

  const handleChange = (nextValue: string) => {
    onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        className="ds-input ds-textarea"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="Ask your question."
        disabled={!canSend || isSubmitting}
      />
      <Button
        className="chat-composer__send"
        type="submit"
        disabled={!canSend || isSubmitting || !value.trim()}
      >
        {isSubmitting ? "Sending..." : "Send"}
      </Button>
    </form>
  );
}
