import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Card, Panel } from "../ui/panel";
import type { SourceExcerpt } from "../../lib/jag-chat";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentPreviewProps {
  citation?: SourceExcerpt | null;
  onClose?: () => void;
}

const DEFAULT_PDF_URL = "/regulations/670-1.pdf";
const DEFAULT_PDF_PAGE = 23;
const PDF_PREVIEW_MIN_WIDTH = 240;
const DEFAULT_VERBATIM_EXCERPT = `All personnel will maintain a high standard of professional dress and appearance. Uniforms will fit properly; the proper fitting of uniforms is provided in DA Pam 670–1. Personnel must keep uniforms clean, serviceable, and roll- pressed, as necessary. Soldiers must project a military image that leaves no doubt that they live by a common military standard and uphold military order and discipline.`;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "under",
  "para",
  "paragraph",
  "citation",
  "regulation",
  "army"
]);

function resolvePdfSourceUrl(citation?: SourceExcerpt | null): string | null {
  const raw = citation?.source?.trim();
  if (!raw) return null;

  const isSafePath = raw.startsWith("/");
  const isSafeAbsoluteUrl = /^https?:\/\//i.test(raw);
  if (!isSafePath && !isSafeAbsoluteUrl) return null;

  const looksLikePdf = /\.pdf(?:[?#]|$)/i.test(raw) || /application\/pdf/i.test(raw);
  if (!looksLikePdf) return null;

  return raw;
}

function resolvePdfPage(pageValue?: string): number {
  const parsed = Number.parseInt(pageValue ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_PDF_PAGE;
}

function resolvePdfOpenUrl(pdfUrl: string, pageNumber: number): string {
  const separator = pdfUrl.includes("#") ? "&" : "#";
  return `${pdfUrl}${separator}page=${pageNumber}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHighlightTerms(citationText: string, excerpt: string): string[] {
  const source = `${citationText} ${excerpt}`;
  const tokens = source
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 4)
    .filter((token) => !STOP_WORDS.has(token));

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
    if (unique.length >= 8) break;
  }

  return unique;
}

function highlightPdfText(str: string, terms: string[]): string {
  if (!terms.length) return str;

  let rendered = str;
  for (const term of terms) {
    const pattern = new RegExp(`(${escapeRegExp(term)})`, "gi");
    rendered = rendered.replace(pattern, '<mark class="document-preview__pdf-text-highlight">$1</mark>');
  }

  return rendered;
}

export default function DocumentPreview({ citation, onClose }: DocumentPreviewProps) {
  const citationText = citation?.label || citation?.citation || "No citation";
  const page = citation?.page || "Not specified";
  const excerpt = citation?.excerpt || citation?.quote || DEFAULT_VERBATIM_EXCERPT;
  const metadataPdfUrl = resolvePdfSourceUrl(citation);
  const pdfSourceUrl = metadataPdfUrl ?? DEFAULT_PDF_URL;
  const pageNumber = metadataPdfUrl ? resolvePdfPage(citation?.page) : DEFAULT_PDF_PAGE;
  const pdfOpenUrl = resolvePdfOpenUrl(pdfSourceUrl, pageNumber);

  const highlightTerms = useMemo(
    () => getHighlightTerms(citationText, excerpt),
    [citationText, excerpt]
  );
  const pdfViewerRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreviewWidth, setPdfPreviewWidth] = useState<number>(PDF_PREVIEW_MIN_WIDTH);
  const scrollToFirstHighlight = useCallback(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const firstHighlight = viewer.querySelector<HTMLElement>(".document-preview__pdf-text-highlight");
        if (!firstHighlight) return;

        const viewerRect = viewer.getBoundingClientRect();
        const highlightRect = firstHighlight.getBoundingClientRect();
        const nextTop =
          viewer.scrollTop + (highlightRect.top - viewerRect.top) - viewer.clientHeight * 0.3;

        viewer.scrollTo({
          top: Math.max(0, nextTop),
          behavior: "smooth"
        });
      });
    });
  }, []);

  useEffect(() => {
    const node = pdfViewerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const nextWidth = Math.max(PDF_PREVIEW_MIN_WIDTH, Math.floor(node.clientWidth) - 16);
      setPdfPreviewWidth(nextWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Panel as="aside" className="workspace-sidebar workspace-sidebar--preview" aria-label="Document preview">
      <header className="sidebar-header document-preview__header">
        <h2 className="document-preview__title-heading">{citationText}</h2>
        <button
          type="button"
          className="document-preview__close document-preview__close--icon"
          onClick={onClose}
          aria-label="Close citation drawer"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="document-preview__content">
        {citation ? (
          <Card as="section" className="document-preview__panel">
            <p className="document-preview__meta">Page: {page}</p>
            <blockquote className="document-preview__excerpt">{excerpt}</blockquote>
            <section className="document-preview__pdf-wrap" aria-label="Regulation PDF preview">
              <div ref={pdfViewerRef} className="document-preview__pdf-viewer">
                <Document
                  file={pdfSourceUrl}
                  className="document-preview__pdf-document"
                  loading={<p className="document-preview__pdf-loading">Loading PDF…</p>}
                  error={<p className="document-preview__pdf-loading">Unable to load PDF preview.</p>}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={pdfPreviewWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer
                    className="document-preview__pdf-page"
                    loading={<p className="document-preview__pdf-loading">Loading page…</p>}
                    onRenderSuccess={scrollToFirstHighlight}
                    customTextRenderer={({ str }) => highlightPdfText(str, highlightTerms)}
                  />
                </Document>
              </div>
              <p className="document-preview__pdf-empty">
                <a
                  href={pdfOpenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-message__link"
                >
                  Open the PDF in a new tab
                </a>
              </p>
            </section>
          </Card>
        ) : (
          <Card as="section" className="document-preview__panel">
            <p className="document-preview__placeholder">
              Select a citation from a response to inspect source text and metadata.
            </p>
          </Card>
        )}
      </div>
    </Panel>
  );
}
