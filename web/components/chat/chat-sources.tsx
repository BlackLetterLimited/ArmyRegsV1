import { Card } from "../ui/panel";
import type { SourceExcerpt } from "../../lib/jag-chat";
import { formatCitationLabel } from "../../lib/citation-format";

interface ChatSourcesProps {
  sources?: SourceExcerpt[];
  onSelectCitation?: (source: SourceExcerpt) => void;
}

function formatParagraphCitation(source: SourceExcerpt) {
  const citation = formatCitationLabel(source);
  const sourceId = source.source_id ? ` (${source.source_id})` : "";

  return `${citation}${sourceId}`;
}

function getExcerpt(source: SourceExcerpt) {
  return source.excerpt || source.quote || "No excerpt provided.";
}

export default function ChatSources({ sources = [], onSelectCitation }: ChatSourcesProps) {
  const hasSources = sources.length > 0;

  return (
    <section className="source-block">
      <details className="source-block__details ds-card" open>
        <summary className="source-block__summary">Legal Authorities and Citations</summary>
        <div className="source-block__content" role="region" aria-live="polite">
          {!hasSources ? (
            <p className="source-block__placeholder">No source citations provided for this response.</p>
          ) : (
            <ol className="source-list">
              {sources.map((source) => (
                <Card as="li" key={source.id} className="source-card">
                  <header className="source-card__header">
                    <button
                      type="button"
                      className="source-card__citation-button"
                      onClick={() => onSelectCitation?.(source)}
                    >
                      {formatParagraphCitation(source)}
                    </button>
                    {source.source ? (
                      <p className="source-card__meta">Source type: {source.source}</p>
                    ) : null}
                  </header>
                  <p className="source-card__excerpt">{getExcerpt(source)}</p>
                </Card>
              ))}
            </ol>
          )}
        </div>
      </details>
    </section>
  );
}
