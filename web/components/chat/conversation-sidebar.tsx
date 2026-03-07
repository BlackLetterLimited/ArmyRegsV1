import { Card, Panel } from "../ui/panel";
import type { ChatMessage } from "../../lib/jag-chat";

interface ConversationSidebarProps {
  messages: ChatMessage[];
}

function snippet(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled entry";
  return compact.length > 76 ? `${compact.slice(0, 76)}…` : compact;
}

export default function ConversationSidebar({ messages }: ConversationSidebarProps) {
  const entries = messages.filter((message) => message.role === "user").map((message) => ({
    id: message.id,
    label: snippet(message.content)
  }));

  return (
    <Panel as="aside" className="workspace-sidebar workspace-sidebar--history" aria-label="Conversation history">
      <header className="sidebar-header">
        <h2 className="ds-heading-3">Conversation history</h2>
        <p className="sidebar-subtitle">This session</p>
      </header>

      <ul className="conversation-list">
        {entries.length === 0 ? (
          <li className="conversation-item conversation-item--empty">No turns yet</li>
        ) : (
          entries.map((entry) => (
            <Card as="li" key={entry.id} className="conversation-item">
              {entry.label}
            </Card>
          ))
        )}
      </ul>
    </Panel>
  );
}
