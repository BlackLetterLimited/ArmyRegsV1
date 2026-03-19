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
  const normalized = value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/paragraph/g, "para")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const citationMatch = normalized.match(
    /\bar\s+([0-9a-z]+(?:\s*-\s*[0-9a-z]+)+)(?:(?:\s*(?:,|;)?\s*para\s+|\s+)([0-9][^,;]*))?/i
  );
  if (!citationMatch) {
    return normalized;
  }

  const regulation = citationMatch[1].replace(/\s*-\s*/g, "-");
  const paragraph = (citationMatch[2] || "")
    .replace(/\b(?:p|page)\.?\s+[0-9a-z-]+$/i, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .trim();

  return paragraph ? `ar ${regulation} para ${paragraph}` : `ar ${regulation}`;
}

function parseCitationParts(
  value: string
): { regulation: string; paragraph: string } | null {
  const normalized = normalizeCitationKey(value);
  const match = normalized.match(/^ar\s+([0-9a-z]+(?:-[0-9a-z]+)+)(?:\s+para\s+(.+))?$/i);
  if (!match) return null;

  return {
    regulation: match[1] || "",
    paragraph: (match[2] || "").trim()
  };
}

function parseLocalParagraphParts(value: string): { paragraph: string } | null {
  const normalized = value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/paragraph/g, "para")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const match = normalized.match(/^para\s*(.+)$/i);
  if (!match) return null;

  const paragraph = match[1]
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .trim();

  return paragraph ? { paragraph } : null;
}

function resolveCitationSource(matchText: string, sources: SourceExcerpt[]): SourceExcerpt | undefined {
  const normalizedMatch = normalizeCitationKey(matchText);
  const normalizeCandidate = (value?: string) => normalizeCitationKey(value ?? "");
  const parsedMatch = parseCitationParts(matchText);

  for (const source of sources) {
    const regulation = (source.regulation || source.title || "").trim();
    const paragraph = (source.paragraph || "").trim();
    const parsedSourceCitation = source.citation ? parseCitationParts(source.citation) : null;

    const candidates = [
      source.citation,
      source.label,
      `${source.label}: ${source.regulation || ""} ${source.paragraph || ""}`.trim(),
      `AR ${regulation} para ${paragraph}`,
      `${regulation} para ${paragraph}`,
      `${source.title || ""} ${paragraph}`
    ];

    const hasExactMatch = candidates.some((candidate) => {
      if (!candidate) return false;
      const normalizedCandidate = normalizeCandidate(candidate);
      return normalizedCandidate === normalizedMatch;
    });

    if (hasExactMatch) {
      return source;
    }

    if (
      parsedMatch &&
      parsedSourceCitation &&
      parsedMatch.regulation === parsedSourceCitation.regulation &&
      parsedMatch.paragraph === parsedSourceCitation.paragraph
    ) {
      return source;
    }

    const normalizedSourceBase = normalizeCandidate(`AR ${regulation} para ${paragraph}`);
    if (
      parsedMatch &&
      parsedMatch.regulation === regulation.toLowerCase() &&
      normalizedSourceBase === normalizedMatch
    ) {
      return source;
    }
  }

  return undefined;
}

function resolveLocalParagraphSource(
  localParagraphText: string,
  regulation: string | null,
  sources: SourceExcerpt[]
): SourceExcerpt | undefined {
  const localParts = parseLocalParagraphParts(localParagraphText);
  if (!localParts) return undefined;

  const normalizedRegulation = regulation?.trim().toLowerCase() ?? "";
  const paragraphMatches: SourceExcerpt[] = [];
  const descendantMatches: SourceExcerpt[] = [];

  for (const source of sources) {
    const sourceParts = parseCitationParts(
      source.citation || `AR ${source.regulation || ""} para ${source.paragraph || ""}`
    );

    if (!sourceParts) continue;

    if (normalizedRegulation) {
      if (sourceParts.regulation !== normalizedRegulation) continue;
    }

    if (sourceParts.paragraph === localParts.paragraph) {
      if (normalizedRegulation) {
        return source;
      }
      paragraphMatches.push(source);
      continue;
    }

    if (sourceParts.paragraph.startsWith(`${localParts.paragraph}(`)) {
      descendantMatches.push(source);
    }
  }

  if (paragraphMatches.length === 1) {
    return paragraphMatches[0];
  }

  if (paragraphMatches.length > 1) {
    return undefined;
  }

  if (descendantMatches.length === 0) {
    return undefined;
  }

  descendantMatches.sort((left, right) => {
    const leftCitation = left.citation || "";
    const rightCitation = right.citation || "";
    return leftCitation.length - rightCitation.length || leftCitation.localeCompare(rightCitation);
  });

  return descendantMatches[0];
}

function citationIdentity(source?: SourceExcerpt | null): string[] {
  if (!source) return [];
  const regulation = (source.regulation || source.title || "").trim();
  const paragraph = (source.paragraph || "").trim();
  const page = (source.page || "").trim();

  return [
    (source.id || "").trim().toLowerCase(),
    (source.source_id || "").trim().toLowerCase(),
    normalizeCitationKey(source.citation || ""),
    normalizeCitationKey(source.label || ""),
    normalizeCitationKey(`${regulation} para ${paragraph}`),
    normalizeCitationKey(`AR ${regulation} para ${paragraph}`),
    normalizeCitationKey(`${regulation} para ${paragraph} p. ${page}`)
  ].filter(Boolean);
}

function isCitationActive(
  citation: SourceExcerpt,
  activeCitation?: SourceExcerpt | null
): boolean {
  const candidateKeys = new Set(citationIdentity(citation));
  if (!candidateKeys.size) return false;
  return citationIdentity(activeCitation).some((key) => candidateKeys.has(key));
}

function buildSelectedCitation(citation: SourceExcerpt, matchedText: string): SourceExcerpt {
  const normalizedMatchedText = matchedText.replace(/\s+/g, " ").trim();
  if (!normalizedMatchedText) return citation;

  return {
    ...citation,
    label: normalizedMatchedText
  };
}

function formatMatchedCitationText(matchedText: string): string {
  return matchedText.replace(/\s+/g, " ").trim();
}

function extractRegulationId(value: string): string | null {
  const match = value.match(
    /\b(?:AR|Army(?:[\s\u00A0\u202F]+)Regulation)[\s\u00A0\u202F]*([0-9A-Za-z]+(?:[\s\u00A0\u202F]*[-‑–—−][\s\u00A0\u202F]*[0-9A-Za-z]+)+)\b/i
  );
  return match ? match[1].replace(/[\s\u00A0\u202F]*[-‑–—−][\s\u00A0\u202F]*/g, "-") : null;
}

function inferSingleRegulationContext(sources: SourceExcerpt[]): string | null {
  const regulations = Array.from(
    new Set(
      sources
        .map((source) => (source.regulation || "").trim())
        .filter(Boolean)
    )
  );

  return regulations.length === 1 ? regulations[0] : null;
}

function buildInferredCitation(localParagraphText: string, regulation: string): string | null {
  const match = localParagraphText.match(/\bpara(?:graph)?[\s\u00A0\u202F]*(.+)$/i);
  if (!match) return null;
  const paragraphText = match[1]?.trim();
  if (!paragraphText) return null;
  return `AR ${regulation} para ${paragraphText}`;
}

function parseCitationSpans(
  text: string,
  scope: string,
  sources: SourceExcerpt[],
  onCitationSelect?: (citation: SourceExcerpt) => void,
  activeCitation?: SourceExcerpt | null
): ReactNode[] {
  const citationPattern =
    /\b(?:AR|Army(?:[\s\u00A0\u202F]+)Regulation)[\s\u00A0\u202F]*[0-9A-Za-z]+(?:[\s\u00A0\u202F]*[-‑–—−][\s\u00A0\u202F]*[0-9A-Za-z]+)+(?:(?:[\s\u00A0\u202F]*(?:,|;)?[\s\u00A0\u202F]*(?:para|paragraph)[\s\u00A0\u202F]*|[\s\u00A0\u202F]+)[0-9][0-9A-Za-z\-‑–—−.]*(?:[\s\u00A0\u202F]*[a-zA-Z](?:[\s\u00A0\u202F]*\([^)]+\))?)?(?:[\s\u00A0\u202F]*\([^)]+\))*)?(?:[\s\u00A0\u202F]*(?:,|;)?[\s\u00A0\u202F]*p(?:age)?\.?[\s\u00A0\u202F]*[0-9A-Za-z-]+)?|\bpara(?:graph)?[\s\u00A0\u202F]*[0-9A-Za-z][0-9A-Za-z\-‑–—−.]*(?:[\s\u00A0\u202F]*[a-zA-Z](?:[\s\u00A0\u202F]*\([^)]+\))?)?(?:[\s\u00A0\u202F]*\([^)]+\))*/giu;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let spanIndex = 0;
  let lastExplicitRegulation = inferSingleRegulationContext(sources);

  while ((match = citationPattern.exec(text)) !== null) {
    const start = match.index;
    const citationText = match[0];
    const isLocalParagraphCitation = /^\s*para(?:graph)?\b/i.test(citationText);

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    if (!isLocalParagraphCitation) {
      lastExplicitRegulation = extractRegulationId(citationText) || lastExplicitRegulation;
    }

    const citation =
      resolveCitationSource(citationText, sources) ||
      (isLocalParagraphCitation
        ? resolveLocalParagraphSource(citationText, lastExplicitRegulation, sources) ||
          (lastExplicitRegulation
            ? resolveCitationSource(
                buildInferredCitation(citationText, lastExplicitRegulation) || "",
                sources
              )
            : undefined)
        : undefined);

    if (onCitationSelect && citation) {
      const selectedCitation = buildSelectedCitation(citation, citationText);
      const active = isCitationActive(selectedCitation, activeCitation);
      const chipText = formatMatchedCitationText(citationText);
      nodes.push(
        <button
          type="button"
          key={`${scope}-citation-${spanIndex}`}
          className={`ds-message__citation-inline ${active ? "ds-message__citation-inline--active" : ""}`}
          title={citationText}
          aria-pressed={active}
          onClick={() => onCitationSelect(selectedCitation)}
        >
          {chipText}
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
  onCitationSelect?: (citation: SourceExcerpt) => void,
  activeCitation?: SourceExcerpt | null
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
          onCitationSelect,
          activeCitation
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
              onCitationSelect,
              activeCitation
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
            onCitationSelect,
            activeCitation
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
            onCitationSelect,
            activeCitation
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
            onCitationSelect,
            activeCitation
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
        onCitationSelect,
        activeCitation
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
  onCitationSelect?: (citation: SourceExcerpt) => void,
  activeCitation?: SourceExcerpt | null
) {
  const children = parseInlineMarkdown(text, `${scope}-h`, sources, onCitationSelect, activeCitation);

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

interface ParsedListItem {
  content: ReactNode[];
  className?: string;
}

function isIndentedBlockStart(line: string): boolean {
  return /^\s{2,}(>\s?.*|#{1,6}\s+.+|[-+*]\s+.+|\d+\.\s+.+|```.*|\|.*)$/.test(line);
}

function appendToLastListItem(items: ParsedListItem[], nodes: ReactNode[]) {
  const lastItem = items[items.length - 1];
  if (!lastItem) return;
  lastItem.content.push(...nodes);
}

function appendBreakToLastListItem(items: ParsedListItem[], scope: string) {
  const lastItem = items[items.length - 1];
  if (!lastItem) return;

  if (lastItem.content.length > 0) {
    lastItem.content.push(<br key={`${scope}-br-${lastItem.content.length}`} />);
  }
}

function formatMarkdownMessage(
  content: string,
  scope: string,
  sources: SourceExcerpt[] = [],
  onCitationSelect?: (citation: SourceExcerpt) => void,
  activeCitation?: SourceExcerpt | null
): ReactNode {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];

  let inCodeBlock = false;
  let codeFenceLanguage = "";
  const codeFence: string[] = [];
  let codeFenceKey = 0;
  let orderedItems: ParsedListItem[] = [];
  let orderedListStart = 1;
  let unorderedItems: ParsedListItem[] = [];
  let blockQuoteLines: string[] = [];
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
        {unorderedItems.map((item, itemIndex) => (
          <li
            key={`${scope}-ul-item-${itemIndex}`}
            className={item.className}
          >
            {item.content}
          </li>
        ))}
      </ul>
    );
    unorderedItems = [];
  };

  const flushOrderedList = () => {
    if (orderedItems.length === 0) return;
    nodes.push(
      <ol
        key={`${scope}-ol-${nodes.length}`}
        className="ds-message__ordered-list"
        start={orderedListStart}
      >
        {orderedItems.map((item, itemIndex) => (
          <li key={`${scope}-ol-item-${itemIndex}`}>{item.content}</li>
        ))}
      </ol>
    );
    orderedItems = [];
    orderedListStart = 1;
  };

  const flushAllLists = () => {
    flushUnorderedList();
    flushOrderedList();
  };

  const flushBlockQuote = () => {
    if (blockQuoteLines.length === 0) return;
    nodes.push(
      <blockquote key={`${scope}-blockquote-${nodes.length}`} className="ds-message__blockquote">
        <div className="ds-message__blockquote-content">
          {formatMarkdownMessage(
            blockQuoteLines.join("\n"),
            `${scope}-blockquote-${nodes.length}`,
            sources,
            onCitationSelect,
            activeCitation
          )}
        </div>
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
                    onCitationSelect,
                    activeCitation
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
                        onCitationSelect,
                        activeCitation
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
    const trimmedLine = line.trim();
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
      nodes.push(
        renderHeading(
          level,
          text,
          `${scope}-heading-${nodes.length}`,
          sources,
          onCitationSelect,
          activeCitation
        )
      );
      continue;
    }

    if (/^\s{0,3}([-*]){3,}\s*$/.test(line)) {
      flushParagraph();
      flushAllLists();
      flushBlockQuote();
      nodes.push(<hr key={`${scope}-hr-${nodes.length}`} className="ds-message__rule" />);
      continue;
    }

    const orderedMatch = line.match(/^\s{0,3}(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushUnorderedList();
      flushBlockQuote();
      if (orderedItems.length === 0) {
        orderedListStart = Number.parseInt(orderedMatch[1] ?? "1", 10) || 1;
      }
      orderedItems.push({
        content: [
          ...parseInlineMarkdown(
          orderedMatch[2],
          `${scope}-ol-item-${orderedItems.length}`,
          sources,
          onCitationSelect,
          activeCitation
          )
        ]
      });
      continue;
    }

    const orderedContinuationMatch =
      orderedItems.length > 0 && !isIndentedBlockStart(line) ? line.match(/^\s{2,}(.*)$/) : null;
    if (orderedContinuationMatch) {
      appendBreakToLastListItem(orderedItems, `${scope}-ol-cont-${orderedItems.length - 1}`);
      appendToLastListItem(
        orderedItems,
        parseInlineMarkdown(
          orderedContinuationMatch[1],
          `${scope}-ol-cont-${orderedItems.length - 1}`,
          sources,
          onCitationSelect,
          activeCitation
        )
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
        unorderedItems.push({
          className: "ds-message__task-list-item",
          content: [
            <span
              key={`${scope}-task-check-${unorderedItems.length}`}
              aria-hidden="true"
              className="ds-message__task-list-check"
            >
              {task.checked ? "✓" : "◻"}
            </span>,
            <span key={`${scope}-task-content-${unorderedItems.length}`}>
              {parseInlineMarkdown(
                task.content,
                `${scope}-task-item-${unorderedItems.length}`,
                sources,
                onCitationSelect,
                activeCitation
              )}
            </span>
          ]
        });
      } else {
        unorderedItems.push({
          content: [
            ...parseInlineMarkdown(
              unorderedMatch[1],
              `${scope}-ul-item-${unorderedItems.length}`,
              sources,
              onCitationSelect,
              activeCitation
            )
          ]
        });
      }
      continue;
    }

    const unorderedContinuationMatch =
      unorderedItems.length > 0 && !isIndentedBlockStart(line) ? line.match(/^\s{2,}(.*)$/) : null;
    if (unorderedContinuationMatch) {
      appendBreakToLastListItem(unorderedItems, `${scope}-ul-cont-${unorderedItems.length - 1}`);
      appendToLastListItem(
        unorderedItems,
        parseInlineMarkdown(
          unorderedContinuationMatch[1],
          `${scope}-ul-cont-${unorderedItems.length - 1}`,
          sources,
          onCitationSelect,
          activeCitation
        )
      );
      continue;
    }

    const quoteMatch = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushAllLists();
      blockQuoteLines.push(quoteMatch[1] ?? "");
      continue;
    }

    const quoteAttributionMatch =
      blockQuoteLines.length > 0 ? trimmedLine.match(/^[\u2014\u2013-]\s*.+$/) : null;
    if (quoteAttributionMatch) {
      blockQuoteLines.push(trimmedLine);
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
      const nextIsListContinuation = !!nextNonEmptyLine?.match(/^\s{2,}\S/);

      if (orderedItems.length > 0 && nextIsOrderedListItem) {
        continue;
      }

      if (orderedItems.length > 0 && nextIsListContinuation) {
        appendBreakToLastListItem(orderedItems, `${scope}-ol-gap-${orderedItems.length - 1}`);
        continue;
      }

      if (unorderedItems.length > 0 && nextIsUnorderedListItem) {
        continue;
      }

      if (unorderedItems.length > 0 && nextIsListContinuation) {
        appendBreakToLastListItem(unorderedItems, `${scope}-ul-gap-${unorderedItems.length - 1}`);
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
        onCitationSelect,
        activeCitation
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
  activeCitation?: SourceExcerpt | null;
}

export default function ChatMessageBubble({
  message,
  onCitationSelect,
  activeCitation
}: ChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const alignClass = message.role === "user" ? "ds-message-row--right" : "";
  const isLoadingPlaceholder = message.isStreaming && !message.content;
  const text =
    message.content || (isLoadingPlaceholder ? "Searching regulations and generating answer..." : "");
  const messageSources = message.sources ?? [];
  const roleLabel = isAssistant ? "ArmyRegs AI" : "You";
  const sourceLabel = messageSources.length === 1 ? "1 citation" : `${messageSources.length} citations`;

  return (
    <article className={`ds-message-row ${alignClass}`}>
      <div className="ds-message-stack">
        <div
          className={`ds-message ${isAssistant ? "ds-message--assistant" : "ds-message--user"} ${
            message.isStreaming ? "ds-message--streaming" : ""
          }`}
        >
          <div className="ds-message__meta">
            <span className="ds-message__role">{roleLabel}</span>
            {isAssistant && messageSources.length > 0 ? (
              <span className="ds-message__source-count">{sourceLabel}</span>
            ) : null}
          </div>
          <div className={`ds-message__body ${isLoadingPlaceholder ? "ds-message__body--loading" : ""}`}>
            {isLoadingPlaceholder ? (
              <span className="ds-message__loading-text">{text}</span>
            ) : (
              formatMarkdownMessage(
                text,
                `msg-${message.id}`,
                messageSources,
                onCitationSelect,
                activeCitation
              )
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
