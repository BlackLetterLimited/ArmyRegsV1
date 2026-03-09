import { type ReactNode } from "react";
import type { ChatMessage, SourceExcerpt } from "../../lib/jag-chat";

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  return withoutOuterPipes
    .split("|")
    .map((value) => value.replace(/\\\|/g, "|").trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }

  const cells = splitTableRow(line);
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }

  return /^\s*\|/.test(trimmed) || /\|\s*$/.test(trimmed) || trimmed.includes("|");
}

function getTableAlignments(line: string): ("left" | "center" | "right")[] {
  return splitTableRow(line).map((cell) => {
    const starts = cell.startsWith(":");
    const ends = cell.endsWith(":");
    if (starts && ends) return "center";
    if (ends) return "right";
    return "left";
  });
}

function normalizeCitationKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/paragraph/g, "para")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCitationSource(matchText: string, sources: SourceExcerpt[]): SourceExcerpt | undefined {
  const normalizedMatch = normalizeCitationKey(matchText);
  const normalizeCandidate = (value?: string) => normalizeCitationKey(value ?? "");

  return sources.find((source) => {
    const regulation = (source.regulation || source.title || "").trim();
    const paragraph = (source.paragraph || "").trim();

    const candidates = [
      source.citation,
      source.label,
      `${source.label}: ${source.regulation || ""} ${source.paragraph || ""}`.trim(),
      normalizeCandidate(source.citation),
      normalizeCandidate(source.label),
      normalizeCitationKey(`AR ${regulation} para ${paragraph}`),
      normalizeCitationKey(`AR ${regulation}`),
      normalizeCitationKey(`${regulation} para ${paragraph}`),
      normalizeCitationKey(`${source.title || ""} ${paragraph}`)
    ];

    return candidates.some((candidate) => {
      if (!candidate) return false;
      const normalizedCandidate = normalizeCandidate(candidate);
      return (
        normalizedCandidate === normalizedMatch ||
        normalizedCandidate.includes(normalizedMatch) ||
        normalizedMatch.includes(normalizedCandidate)
      );
    });
  });
}

function formatCitationChipLabel(source: SourceExcerpt): string {
  const baseRegulation = (source.regulation || source.title || "AR").trim();
  const regulation = /^AR\b/i.test(baseRegulation) ? baseRegulation : `AR ${baseRegulation}`;
  const paragraph = source.paragraph?.trim();
  const page = source.page?.trim();

  const parts = [regulation];
  if (paragraph) {
    parts.push(`para ${paragraph}`);
  }
  if (page) {
    parts.push(`p. ${page}`);
  }

  return parts.join(" · ");
}

function buildFallbackCitationSource(citationText: string): SourceExcerpt {
  const normalized = citationText.replace(/\s+/g, " ").trim();
  const regulationMatch = normalized.match(
    /(?:AR|Army\s+Regulation)\s*([0-9A-Za-z]+(?:\s*[-‑–—−]\s*[0-9A-Za-z]+)+)/i
  );
  const paragraphMatch = normalized.match(
    /(?:para|paragraph)\s*([0-9A-Za-z][0-9A-Za-z\-.\u2010-\u2015]*(?:\s+[a-zA-Z](?:\([^)]+\))?)?(?:\([^)]+\))*)/i
  );
  const pageMatch = normalized.match(/\b(?:page|p\.)\s*([0-9A-Za-z-]+)/i);

  const regulation = regulationMatch?.[1]?.replace(/\s+/g, "") ?? "Regulation";
  const paragraph = paragraphMatch?.[1] ?? "";
  const page = pageMatch?.[1] ?? "";
  const idBase = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fallbackId = idBase.length > 0 ? `inline-${idBase}` : `inline-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: fallbackId,
    source_id: fallbackId,
    citation: normalized,
    label: normalized,
    regulation,
    paragraph,
    page,
    excerpt: "Source metadata not provided by backend for this inline citation.",
    chunk_id: ""
  };
}

function parseCitationSpans(
  text: string,
  scope: string,
  sources: SourceExcerpt[],
  onCitationSelect?: (citation: SourceExcerpt) => void
): ReactNode[] {
  const citationPattern =
    /\b(?:AR|Army(?:[\s\u00A0\u202F]+)Regulation)[\s\u00A0\u202F]*[0-9A-Za-z]+(?:[\s\u00A0\u202F]*[-‑–—−][\s\u00A0\u202F]*[0-9A-Za-z]+)+(?:[\s\u00A0\u202F]*(?:,|;)?[\s\u00A0\u202F]*(?:para|paragraph)[\s\u00A0\u202F]*[0-9A-Za-z][0-9A-Za-z\-‑–—−.]*(?:[\s\u00A0\u202F]+[a-zA-Z](?:\([^)]+\))?)?(?:\([^)]+\))*)?(?:[\s\u00A0\u202F]*(?:,|;)?[\s\u00A0\u202F]*p(?:age)?\.?[\s\u00A0\u202F]*[0-9A-Za-z-]+)?/giu;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let spanIndex = 0;

  while ((match = citationPattern.exec(text)) !== null) {
    const start = match.index;
    const citationText = match[0];

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    const resolved = resolveCitationSource(citationText, sources);
    const citation = resolved ?? buildFallbackCitationSource(citationText);

    if (onCitationSelect) {
      nodes.push(
        <button
          type="button"
          key={`${scope}-citation-${spanIndex}`}
          className="ds-message__citation-inline"
          title={citationText}
          onClick={() => onCitationSelect(citation)}
        >
          {formatCitationChipLabel(citation)}
        </button>
      );
    } else {
      nodes.push(citationText);
    }

    spanIndex += 1;
    lastIndex = citationPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseInlineMarkdown(
  text: string,
  scope: string,
  sources: SourceExcerpt[] = [],
  onCitationSelect?: (citation: SourceExcerpt) => void
): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /!\[([^\]]*?)\]\(([^)\s]+(?:\s+"[^"]*")?)\)|\[((?:[^\[\]\\]|\\.)+?)\]\(([^)\s]+(?:\s+"[^"]*")?)\)|\*\*\*(.*?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|_(.+?)_|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      result.push(
        ...parseCitationSpans(
          text.slice(lastIndex, start),
          `${scope}-plain-${start}`,
          sources,
          onCitationSelect
        )
      );
    }

    const imageText = match[1];
    const imageUrl = match[2];
    const linkText = match[3];
    const linkUrlOrMeta = match[4];
    const boldItalicText = match[5];
    const boldText = match[6] || match[7];
    const strikeText = match[8];
    const italicText = match[9] || match[10];
    const codeText = match[11];

    if (imageText !== undefined && imageUrl) {
      const parsedImage = imageUrl.match(/^(https?:\/\/[^\s]+)(?:\s+"([^"]+)")?$/);
      result.push(
        <img
          key={`${scope}-img-${start}`}
          src={parsedImage?.[1] ?? imageUrl}
          alt={imageText}
          title={parsedImage?.[2]}
          className="ds-message__image"
        />
      );
    } else if (linkText !== undefined && linkUrlOrMeta) {
      const parsed = linkUrlOrMeta.match(/^(https?:\/\/[^\s]+)(?:\s+"([^"]+)")?$/);
      const href = parsed?.[1] ?? linkUrlOrMeta;
      const title = parsed?.[2];

      result.push(
        <a
          key={`${scope}-link-${start}`}
          href={href}
          title={title}
          target="_blank"
          rel="noopener noreferrer"
          className="ds-message__link"
        >
          {linkText}
        </a>
      );
    } else if (boldItalicText !== undefined) {
      result.push(
        <strong key={`${scope}-strong-em-${start}`}>
          <em>
            {parseCitationSpans(
              boldItalicText,
              `${scope}-strong-em-cite-${start}`,
              sources,
              onCitationSelect
            )}
          </em>
        </strong>
      );
    } else if (boldText !== undefined) {
      result.push(
        <strong key={`${scope}-strong-${start}`}>
          {parseCitationSpans(
            boldText,
            `${scope}-strong-cite-${start}`,
            sources,
            onCitationSelect
          )}
        </strong>
      );
    } else if (strikeText !== undefined) {
      result.push(
        <del key={`${scope}-del-${start}`}>
          {parseCitationSpans(
            strikeText,
            `${scope}-strike-cite-${start}`,
            sources,
            onCitationSelect
          )}
        </del>
      );
    } else if (italicText !== undefined) {
      result.push(
        <em key={`${scope}-em-${start}`}>
          {parseCitationSpans(
            italicText,
            `${scope}-italic-cite-${start}`,
            sources,
            onCitationSelect
          )}
        </em>
      );
    } else if (codeText !== undefined) {
      result.push(
        <code key={`${scope}-code-${start}`} className="ds-message__code">
          {codeText}
        </code>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push(
      ...parseCitationSpans(
        text.slice(lastIndex),
        `${scope}-plain-tail`,
        sources,
        onCitationSelect
      )
    );
  }

  return result;
}

function parseTaskListItem(raw: string): { checked: boolean; content: string } | null {
  const match = raw.match(/^\[([xX ])\]\s+(.*)$/);
  if (!match) {
    return null;
  }

  return {
    checked: match[1].toLowerCase() === "x",
    content: match[2].trim()
  };
}

function renderHeading(
  level: number,
  text: string,
  scope: string,
  sources: SourceExcerpt[],
  onCitationSelect?: (citation: SourceExcerpt) => void
) {
  const children = parseInlineMarkdown(text, `${scope}-h`, sources, onCitationSelect);

  switch (level) {
    case 1:
      return (
        <h1 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--1">
          {children}
        </h1>
      );
    case 2:
      return (
        <h2 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--2">
          {children}
        </h2>
      );
    case 3:
      return (
        <h3 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--3">
          {children}
        </h3>
      );
    case 4:
      return (
        <h4 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--4">
          {children}
        </h4>
      );
    case 5:
      return (
        <h5 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--5">
          {children}
        </h5>
      );
    default:
      return (
        <h6 key={`${scope}-h${level}`} className="ds-message__heading ds-message__heading--6">
          {children}
        </h6>
      );
  }
}

function renderParagraph(lines: ReactNode[], scope: string, key: string) {
  if (lines.length === 0) return null;
  return (
    <p key={key} className="ds-message__paragraph">
      {lines}
    </p>
  );
}

function formatMarkdownMessage(
  content: string,
  scope: string,
  sources: SourceExcerpt[] = [],
  onCitationSelect?: (citation: SourceExcerpt) => void
): ReactNode {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];

  let inCodeBlock = false;
  let codeFenceLanguage = "";
  const codeFence: string[] = [];
  let codeFenceKey = 0;
  let orderedItems: ReactNode[] = [];
  let unorderedItems: ReactNode[] = [];
  let blockQuoteLines: ReactNode[] = [];
  const paragraphLines: ReactNode[] = [];

  let inTable = false;
  let tableHeader: string[] = [];
  let tableAlign: ("left" | "center" | "right")[] = [];
  let tableRows: string[][] = [];

  const flushCodeBlock = () => {
    if (!inCodeBlock || codeFence.length === 0) return;

    nodes.push(
      <pre
        key={`${scope}-codeblock-${codeFenceKey++}`}
        className="ds-message__code-block"
        data-language={codeFenceLanguage}
      >
        <code>{codeFence.join("\n")}</code>
      </pre>
    );
    codeFence.length = 0;
    codeFenceLanguage = "";
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    nodes.push(renderParagraph([...paragraphLines], scope, `${scope}-p-${nodes.length}`));
    paragraphLines.length = 0;
  };

  const flushUnorderedList = () => {
    if (unorderedItems.length === 0) return;
    nodes.push(
      <ul key={`${scope}-ul-${nodes.length}`} className="ds-message__unordered-list">
        {unorderedItems}
      </ul>
    );
    unorderedItems = [];
  };

  const flushOrderedList = () => {
    if (orderedItems.length === 0) return;
    nodes.push(
      <ol key={`${scope}-ol-${nodes.length}`} className="ds-message__ordered-list">
        {orderedItems}
      </ol>
    );
    orderedItems = [];
  };

  const flushAllLists = () => {
    flushUnorderedList();
    flushOrderedList();
  };

  const flushBlockQuote = () => {
    if (blockQuoteLines.length === 0) return;
    nodes.push(
      <blockquote key={`${scope}-blockquote-${nodes.length}`} className="ds-message__blockquote">
        <div className="ds-message__blockquote-content">{blockQuoteLines}</div>
      </blockquote>
    );
    blockQuoteLines = [];
  };

  const flushTable = () => {
    if (!inTable || tableHeader.length === 0) {
      tableHeader = [];
      tableAlign = [];
      tableRows = [];
      inTable = false;
      return;
    }

    const columnCount = Math.max(
      tableHeader.length,
      ...tableRows.map((row) => row.length),
      1
    );

    const normalizedHeader = [...tableHeader];
    const normalizedAlign = [...tableAlign];
    while (normalizedHeader.length < columnCount) {
      normalizedHeader.push("");
      normalizedAlign.push("left");
    }

    nodes.push(
      <div key={`${scope}-table-wrap-${nodes.length}`} className="ds-message__table-wrap">
        <table className="ds-message__table">
          <thead>
            <tr>
              {normalizedHeader.map((cell, index) => (
                <th
                  key={`${scope}-th-${index}`}
                  style={{ textAlign: normalizedAlign[index] ?? "left" }}
                >
                  {parseInlineMarkdown(
                    cell,
                    `${scope}-th-${index}`,
                    sources,
                    onCitationSelect
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, rowIndex) => {
              const normalizedRow = [...row];
              while (normalizedRow.length < columnCount) {
                normalizedRow.push("");
              }
              return (
                <tr key={`${scope}-tr-${rowIndex}`}>
                  {normalizedRow.map((cell, cellIndex) => (
                    <td
                      key={`${scope}-td-${rowIndex}-${cellIndex}`}
                      style={{ textAlign: normalizedAlign[cellIndex] ?? "left" }}
                    >
                      {parseInlineMarkdown(
                        cell,
                        `${scope}-td-${rowIndex}-${cellIndex}`,
                        sources,
                        onCitationSelect
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

    tableHeader = [];
    tableAlign = [];
    tableRows = [];
    inTable = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.replace(/\r$/, "");
    const fenceMatch = line.match(/^\s*```(.*)$/);

    if (fenceMatch) {
      if (!inCodeBlock) {
        flushParagraph();
        flushAllLists();
        flushBlockQuote();
        flushTable();
        inCodeBlock = true;
        codeFenceLanguage = fenceMatch[1]?.trim() || "";
        continue;
      }

      inCodeBlock = false;
      flushCodeBlock();
      continue;
    }

    if (inCodeBlock) {
      codeFence.push(line);
      continue;
    }

    if (inTable) {
      if (!line.trim()) {
        flushTable();
        continue;
      }

      if (isTableRow(line)) {
        tableRows.push(splitTableRow(line));
        continue;
      }

      flushTable();
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushAllLists();
      flushBlockQuote();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      nodes.push(renderHeading(level, text, `${scope}-heading-${nodes.length}`, sources, onCitationSelect));
      continue;
    }

    if (/^\s{0,3}([-*]){3,}\s*$/.test(line)) {
      flushParagraph();
      flushAllLists();
      flushBlockQuote();
      nodes.push(<hr key={`${scope}-hr-${nodes.length}`} className="ds-message__rule" />);
      continue;
    }

    const orderedMatch = line.match(/^\s{0,3}\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushUnorderedList();
      flushBlockQuote();
      orderedItems.push(
        <li key={`${scope}-ol-item-${orderedItems.length}`}>
          {parseInlineMarkdown(
            orderedMatch[1],
            `${scope}-ol-item-${orderedItems.length}`,
            sources,
            onCitationSelect
          )}
        </li>
      );
      continue;
    }

    const unorderedMatch = line.match(/^\s{0,3}[-+*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushOrderedList();
      flushBlockQuote();
      const task = parseTaskListItem(unorderedMatch[1] ?? "");
      if (task) {
        unorderedItems.push(
          <li
            key={`${scope}-task-item-${unorderedItems.length}`}
            className="ds-message__task-list-item"
          >
            <span aria-hidden="true" className="ds-message__task-list-check">
              {task.checked ? "✓" : "◻"}
            </span>
            <span>
              {parseInlineMarkdown(
                task.content,
                `${scope}-task-item-${unorderedItems.length}`,
                sources,
                onCitationSelect
              )}
            </span>
          </li>
        );
      } else {
        unorderedItems.push(
          <li key={`${scope}-ul-item-${unorderedItems.length}`}>
            {parseInlineMarkdown(
              unorderedMatch[1],
              `${scope}-ul-item-${unorderedItems.length}`,
              sources,
              onCitationSelect
            )}
          </li>
        );
      }
      continue;
    }

    const quoteMatch = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushAllLists();
      if (quoteMatch[1] !== "") {
        blockQuoteLines.push(
          <p key={`${scope}-quote-${blockQuoteLines.length}`}>
            {parseInlineMarkdown(
              quoteMatch[1],
              `${scope}-quote-${blockQuoteLines.length}`,
              sources,
              onCitationSelect
            )}
          </p>
        );
      } else {
        blockQuoteLines.push(<p key={`${scope}-quote-${blockQuoteLines.length}`} />);
      }
      continue;
    }

    if (isTableRow(line) && isTableSeparator(lines[index + 1] ?? "")) {
      flushParagraph();
      flushAllLists();
      flushBlockQuote();
      tableHeader = splitTableRow(line);
      tableAlign = getTableAlignments(lines[index + 1] ?? "");
      tableRows = [];
      inTable = true;
      index += 1;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushBlockQuote();

      const nextNonEmptyLine = lines
        .slice(index + 1)
        .find((candidate) => (candidate ?? "").trim() !== "")
        ?.replace(/\r$/, "");
      const nextIsOrderedListItem = !!nextNonEmptyLine?.match(/^\s{0,3}\d+\.\s+(.*)$/);
      const nextIsUnorderedListItem = !!nextNonEmptyLine?.match(/^\s{0,3}[-+*]\s+(.*)$/);

      if (orderedItems.length > 0 && nextIsOrderedListItem) {
        continue;
      }

      if (unorderedItems.length > 0 && nextIsUnorderedListItem) {
        continue;
      }

      flushAllLists();
      continue;
    }

    if (orderedItems.length > 0 || unorderedItems.length > 0) {
      flushAllLists();
    }

    if (blockQuoteLines.length > 0) {
      flushBlockQuote();
    }

    if (paragraphLines.length > 0) {
      paragraphLines.push(<br key={`${scope}-br-${paragraphLines.length}`} />);
    }

    paragraphLines.push(
      ...parseInlineMarkdown(
        line,
        `${scope}-line-${paragraphLines.length}`,
        sources,
        onCitationSelect
      )
    );
  }

  flushParagraph();
  flushAllLists();
  flushBlockQuote();
  flushTable();
  if (inCodeBlock) {
    flushCodeBlock();
  }

  return <>{nodes}</>;
}

interface ChatMessageProps {
  message: ChatMessage;
  onCitationSelect?: (citation: SourceExcerpt) => void;
}

export default function ChatMessageBubble({ message, onCitationSelect }: ChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const alignClass = message.role === "user" ? "ds-message-row--right" : "";
  const text = message.content || (message.isStreaming ? "Thinking..." : "");
  const messageSources = message.sources ?? [];

  return (
    <article className={`ds-message-row ${alignClass}`}>
      <div className="ds-message-stack">
        <div className={`ds-message ${isAssistant ? "ds-message--assistant" : "ds-message--user"}`}>
          <div className="ds-message__body">
            {formatMarkdownMessage(
              text,
              `msg-${message.id}`,
              messageSources,
              onCitationSelect
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
