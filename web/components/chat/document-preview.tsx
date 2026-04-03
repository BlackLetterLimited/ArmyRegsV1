import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Card, Panel } from "../ui/panel";
import type { SourceExcerpt } from "../../lib/jag-chat";
import { formatCitationLabel } from "../../lib/citation-format";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentPreviewProps {
  citation?: SourceExcerpt | null;
  onClose?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

interface PdfTextItem {
  str: string;
  itemIndex: number;
  hasEOL?: boolean;
}

function arePdfTextItemsEqual(left: PdfTextItem[], right: PdfTextItem[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];

    if (
      leftItem?.itemIndex !== rightItem?.itemIndex ||
      leftItem?.str !== rightItem?.str ||
      leftItem?.hasEOL !== rightItem?.hasEOL
    ) {
      return false;
    }
  }

  return true;
}

const DEFAULT_PDF_URL = "/regulations/670-1.pdf";
const DEFAULT_PDF_PAGE = 23;
const PDF_PREVIEW_MIN_WIDTH = 240;
const SHOW_PDF_DEBUG = false;
const DEFAULT_VERBATIM_EXCERPT = `All personnel will maintain a high standard of professional dress and appearance. Uniforms will fit properly; the proper fitting of uniforms is provided in DA Pam 670–1. Personnel must keep uniforms clean, serviceable, and roll- pressed, as necessary. Soldiers must project a military image that leaves no doubt that they live by a common military standard and uphold military order and discipline.`;
const AVAILABLE_REGULATION_PDFS = new Set([
  "1-10",
  "1-50",
  "1-100",
  "15-6",
  "20-1",
  "27-1",
  "27-3",
  "27-10",
  "27-20",
  "27-26",
  "215-1",
  "350-1",
  "600-9",
  "600-20",
  "600-37",
  "600-52",
  "600-85",
  "600-100",
  "600-8-2",
  "600-8-4",
  "600-8-10",
  "600-8-19",
  "600-8-22",
  "600-8-24",
  "608-99",
  "623-3",
  "630-10",
  "635-200",
  "670-1",
  "735-5"
]);

function normalizeRegulationId(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");

  const match = normalized.match(
    /\b(?:AR|Army\s+Regulation)?\s*([0-9A-Za-z]+(?:\s*-\s*[0-9A-Za-z]+)+)\b/i
  );

  return match ? match[1].replace(/\s*-\s*/g, "-") : null;
}

function resolveRegulationPdfUrl(citation?: SourceExcerpt | null): string | null {
  const candidates = [
    citation?.regulation,
    citation?.title,
    citation?.citation,
    citation?.label
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const regulationId = normalizeRegulationId(candidate);
    if (!regulationId) continue;
    if (!AVAILABLE_REGULATION_PDFS.has(regulationId)) continue;
    return `/regulations/${regulationId}.pdf`;
  }

  return null;
}

function resolvePdfPage(pageValue?: string): number {
  const parsed = Number.parseInt(pageValue ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_PDF_PAGE;
}

function formatPageLabel(citation?: SourceExcerpt | null): string {
  const pageStart = citation?.page_start?.trim() || citation?.page?.trim();
  const pageEnd = citation?.page_end?.trim();
  if (!pageStart) return "Not specified";
  if (pageEnd && pageEnd !== pageStart) {
    return `${pageStart}-${pageEnd}`;
  }
  return pageStart;
}

function resolvePdfPageRange(citation?: SourceExcerpt | null): number[] {
  const startPage = resolvePdfPage(citation?.page_start || citation?.page);
  const endValue = citation?.page_end?.trim();

  if (!endValue) return [startPage];

  const endPage = resolvePdfPage(endValue);
  const rangeStart = Math.min(startPage, endPage);
  const rangeEnd = Math.max(startPage, endPage);
  const pageNumbers: number[] = [];

  for (let pageNumber = rangeStart; pageNumber <= rangeEnd; pageNumber += 1) {
    pageNumbers.push(pageNumber);
  }

  return pageNumbers;
}

function resolvePdfOpenUrl(pdfUrl: string, pageNumber: number): string {
  const separator = pdfUrl.includes("#") ? "&" : "#";
  return `${pdfUrl}${separator}page=${pageNumber}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type SearchMode = "default" | "relaxed";

function normalizeSearchChar(char: string): string {
  if (char === "\u00a0") return " ";
  if (/[\u2010\u2011\u2012\u2013\u2014\u2212]/.test(char)) return "-";
  if (/[\u2018\u2019\u2032]/.test(char)) return "'";
  if (/[\u201c\u201d]/.test(char)) return '"';
  if (char === "\u00ad") return "";
  return char;
}

function createNormalizedIndex(value: string, mode: SearchMode = "default"): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const rawChar = value[index];
    if (!rawChar) continue;

    const char = normalizeSearchChar(rawChar);

    if (!char) continue;
    if (/\s/.test(char)) continue;

    if (mode === "relaxed" && char === "-") {
      const previousChar = index > 0 ? normalizeSearchChar(value[index - 1] ?? "") : "";
      let shouldSkipHyphen = false;
      let nextIndex = index + 1;
      while (nextIndex < value.length) {
        const nextCandidate = normalizeSearchChar(value[nextIndex] ?? "");
        if (!nextCandidate) {
          nextIndex += 1;
          continue;
        }
        if (/\s/.test(nextCandidate)) {
          nextIndex += 1;
          continue;
        }
        if (/[A-Za-z]/.test(previousChar) && /[A-Za-z]/.test(nextCandidate)) {
          // Ignore line-break hyphenation like "investiga- tion" in relaxed mode.
          shouldSkipHyphen = true;
        }
        break;
      }

      if (shouldSkipHyphen) continue;
    }

    const relaxedAllowed = /[A-Za-z0-9@._/-]/;
    if (mode === "relaxed" && !relaxedAllowed.test(char)) continue;

    normalized += char.toLowerCase();
    map.push(index);
  }

  return {
    normalized,
    map
  };
}

function buildPageTextIndex(segments: string[]): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let globalOffset = 0;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex] ?? "";
    const previousChar = text[text.length - 1] ?? "";
    const nextChar = segment[0] ?? "";
    const needsSyntheticSpace =
      text.length > 0 &&
      /[A-Za-z0-9)]/.test(previousChar) &&
      /[(A-Za-z0-9]/.test(nextChar);

    if (needsSyntheticSpace) {
      text += " ";
      map.push(Math.max(0, globalOffset - 1));
    }

    for (let charIndex = 0; charIndex < segment.length; charIndex += 1) {
      text += segment[charIndex];
      map.push(globalOffset + charIndex);
    }

    globalOffset += segment.length;
  }

  return { text, map };
}

function isPdfTextItem(value: unknown): value is { str: string; hasEOL?: boolean } {
  if (!value || typeof value !== "object") return false;

  const candidate = value as { str?: unknown; hasEOL?: unknown };
  return (
    typeof candidate.str === "string" &&
    (typeof candidate.hasEOL === "undefined" || typeof candidate.hasEOL === "boolean")
  );
}

function buildTextItemIndex(items: PdfTextItem[]): {
  text: string;
  map: Array<{ itemIndex: number; charIndex: number }>;
  itemBounds: Array<{ itemIndex: number; start: number; end: number; text: string }>;
} {
  let text = "";
  const map: Array<{ itemIndex: number; charIndex: number }> = [];
  const itemBounds: Array<{ itemIndex: number; start: number; end: number; text: string }> = [];

  items.forEach((item, index) => {
    const currentText = item.str ?? "";
    const previousChar = text[text.length - 1] ?? "";
    const nextChar = currentText[0] ?? "";
    const needsSyntheticSpace =
      text.length > 0 &&
      /[A-Za-z0-9)]/.test(previousChar) &&
      /[(A-Za-z0-9]/.test(nextChar);

    if (needsSyntheticSpace) {
      text += " ";
      map.push({
        itemIndex: items[Math.max(0, index - 1)]?.itemIndex ?? item.itemIndex,
        charIndex: Math.max(0, (items[Math.max(0, index - 1)]?.str?.length ?? 1) - 1)
      });
    }

    const start = text.length;
    for (let charIndex = 0; charIndex < currentText.length; charIndex += 1) {
      text += currentText[charIndex];
      map.push({ itemIndex: item.itemIndex, charIndex });
    }

    itemBounds.push({
      itemIndex: item.itemIndex,
      start,
      end: text.length,
      text: currentText
    });

    if (item.hasEOL) {
      text += " ";
      map.push({
        itemIndex: item.itemIndex,
        charIndex: Math.max(0, currentText.length - 1)
      });
    }
  });

  return { text, map, itemBounds };
}

function collectExcerptFragments(excerpt: string): string[] {
  const rawExcerpt = excerpt
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u00ad/g, "")
    .trim();
  if (!rawExcerpt) return [];

  const candidates: string[] = [rawExcerpt];
  const words = rawExcerpt.split(/\s+/).filter(Boolean);
  const maxDroppedWords = Math.min(12, Math.max(0, words.length - 1));

  for (let dropped = 1; dropped <= maxDroppedWords; dropped += 1) {
    const suffix = words.slice(dropped).join(" ").trim();
    if (suffix.length < 40) continue;
    candidates.push(suffix);
  }

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

function collectSentenceFragments(excerpt: string): string[] {
  const rawExcerpt = excerpt
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u00ad/g, "")
    .trim();
  if (!rawExcerpt) return [];

  return Array.from(
    new Set(
      rawExcerpt
        .split(/(?<=[.!?;:])\s+|\n+/)
        .map((fragment) => fragment.trim())
        .filter((fragment) => fragment.length >= 24)
    )
  );
}

function mergeRanges(
  ...rangeGroups: Array<Array<{ start: number; end: number }>>
): Array<{ start: number; end: number }> {
  const combined = rangeGroups
    .flat()
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);

  if (combined.length === 0) return [];

  const merged: Array<{ start: number; end: number }> = [combined[0]];

  for (let index = 1; index < combined.length; index += 1) {
    const current = combined[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function selectPrimaryRangeCluster(
  ranges: Array<{ start: number; end: number }>,
  gapThreshold = 180
): Array<{ start: number; end: number }> {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const clusters: Array<Array<{ start: number; end: number }>> = [[sorted[0]]];

  for (let index = 1; index < sorted.length; index += 1) {
    const range = sorted[index];
    const currentCluster = clusters[clusters.length - 1];
    const previous = currentCluster[currentCluster.length - 1];

    if (range.start - previous.end <= gapThreshold) {
      currentCluster.push(range);
      continue;
    }

    clusters.push([range]);
  }

  let bestCluster = clusters[0];
  let bestScore = -1;

  for (const cluster of clusters) {
    const totalCovered = cluster.reduce((sum, range) => sum + (range.end - range.start), 0);
    const span = cluster[cluster.length - 1].end - cluster[0].start;
    const score = totalCovered * 4 - span;

    if (score > bestScore) {
      bestScore = score;
      bestCluster = cluster;
    }
  }

  return bestCluster;
}

function collectExcerptWindows(excerpt: string): string[] {
  const normalized = excerpt
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u00ad/g, "")
    .trim();

  const words = normalized
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => /[A-Za-z0-9]/.test(word));

  if (words.length === 0) return [];

  const windows: string[] = [];
  const configs =
    words.length <= 8
      ? [{ size: Math.min(words.length, 5), step: 1 }]
      : [
          { size: 6, step: 4 },
          { size: 4, step: 2 }
        ];

  for (const { size, step } of configs) {
    for (let start = 0; start < words.length; start += step) {
      const chunk = words.slice(start, start + size);
      if (chunk.length < Math.min(3, size)) continue;
      windows.push(chunk.join(" "));
    }
  }

  if (words.length >= 4) {
    windows.push(words.slice(0, Math.min(words.length, 6)).join(" "));
    windows.push(words.slice(Math.max(0, words.length - 6)).join(" "));
  }

  return Array.from(new Set(windows));
}

function expandRangeEdgesToExcerpt(
  pageText: string,
  excerpt: string,
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];

  const normalizedExcerpt = createNormalizedIndex(excerpt, "relaxed").normalized;
  if (!normalizedExcerpt) return ranges;

  return ranges.map((range) => {
    let start = range.start;
    let end = range.end;

    const leftBound = Math.max(0, start - 32);
    for (let candidateStart = start - 1; candidateStart >= leftBound; candidateStart -= 1) {
      const segment = pageText.slice(candidateStart, end);
      const normalizedSegment = createNormalizedIndex(segment, "relaxed").normalized;
      if (!normalizedSegment) continue;
      if (!normalizedExcerpt.includes(normalizedSegment)) continue;

      const addedPrefix = pageText.slice(candidateStart, start);
      const prefixWordCount = (addedPrefix.match(/[A-Za-z0-9]+/g) ?? []).length;
      if (prefixWordCount > 2) continue;
      if (!/^[\sA-Za-z0-9"'()\-–—]+$/.test(addedPrefix)) continue;

      start = candidateStart;
    }

    const rightBound = Math.min(pageText.length, end + 32);
    for (let candidateEnd = end + 1; candidateEnd <= rightBound; candidateEnd += 1) {
      const segment = pageText.slice(start, candidateEnd);
      const normalizedSegment = createNormalizedIndex(segment, "relaxed").normalized;
      if (!normalizedSegment) continue;
      if (!normalizedExcerpt.includes(normalizedSegment)) continue;

      const addedSuffix = pageText.slice(end, candidateEnd);
      const suffixWordCount = (addedSuffix.match(/[A-Za-z0-9]+/g) ?? []).length;
      if (suffixWordCount > 2) continue;
      if (!/^[\sA-Za-z0-9"'()\-–—]+$/.test(addedSuffix)) continue;

      end = candidateEnd;
    }

    return { start, end };
  });
}

function findExcerptMatchRanges(
  pageText: string,
  excerpt: string,
  pageOffsetMap?: number[]
): Array<{ start: number; end: number }> {
  const searchModes: SearchMode[] = ["default", "relaxed"];
  const normalizedExcerpt = excerpt.replace(/\s+/g, " ").trim();
  const isLongExcerpt =
    normalizedExcerpt.length > 320 ||
    normalizedExcerpt.split(/\s+/).length > 48 ||
    /\bTable\s+\d/i.test(normalizedExcerpt);

  const addCandidateMatches = (
    candidates: string[],
    options?: { stopOnFirstCandidate?: boolean }
  ): Array<{ start: number; end: number }> => {
    if (candidates.length === 0) return [];

    const ranges: Array<{ start: number; end: number }> = [];
    const seen = new Set<string>();

    for (const mode of searchModes) {
      const { normalized: normalizedPage, map } = createNormalizedIndex(pageText, mode);
      if (!normalizedPage) continue;

      for (const candidate of candidates) {
        const { normalized: normalizedCandidate } = createNormalizedIndex(candidate, mode);
        if (!normalizedCandidate) continue;

        let candidateMatched = false;
        let fromIndex = 0;

        while (fromIndex < normalizedPage.length) {
          const normalizedStart = normalizedPage.indexOf(normalizedCandidate, fromIndex);
          if (normalizedStart === -1) break;

          const normalizedEnd = normalizedStart + normalizedCandidate.length;
          const rawStart = map[normalizedStart];
          const rawEnd = (map[normalizedEnd - 1] ?? rawStart) + 1;
          const start = pageOffsetMap?.[rawStart] ?? rawStart;
          const endBase = pageOffsetMap?.[Math.max(0, rawEnd - 1)] ?? Math.max(0, rawEnd - 1);
          const end = endBase + 1;
          const key = `${start}:${end}`;

          if (!seen.has(key)) {
            seen.add(key);
            ranges.push({ start, end });
          }

          candidateMatched = true;
          fromIndex = normalizedStart + 1;
        }

        if (candidateMatched && options?.stopOnFirstCandidate) {
          return ranges.sort((left, right) => left.start - right.start);
        }
      }

      if (ranges.length > 0) {
        return ranges.sort((left, right) => left.start - right.start);
      }
    }

    return [];
  };

  if (!isLongExcerpt) {
    const exactRanges = addCandidateMatches(collectExcerptFragments(excerpt), {
      stopOnFirstCandidate: true
    });
    if (exactRanges.length > 0) return exactRanges;
  }

  const sentenceRanges = addCandidateMatches(collectSentenceFragments(excerpt));
  const windowRanges = addCandidateMatches(collectExcerptWindows(excerpt));

  if (isLongExcerpt) {
    const mergedLongRanges = mergeRanges(sentenceRanges, windowRanges);
    if (mergedLongRanges.length > 0) return selectPrimaryRangeCluster(mergedLongRanges);
  } else {
    if (sentenceRanges.length > 0) return selectPrimaryRangeCluster(sentenceRanges);
    if (windowRanges.length > 0) return selectPrimaryRangeCluster(windowRanges);
  }

  if (isLongExcerpt) {
    return selectPrimaryRangeCluster(
      addCandidateMatches(collectExcerptFragments(excerpt), {
        stopOnFirstCandidate: true
      })
    );
  }

  return [];
}

function applyPdfHighlights(viewer: HTMLDivElement, excerpt: string): boolean {
  const textLayer = viewer.querySelector<HTMLElement>(".react-pdf__Page__textContent");
  if (!textLayer) return false;

  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>("span"));
  if (spans.length === 0) return false;

  const segments = spans.map((span) => {
    const originalText = span.dataset.originalText ?? span.textContent ?? "";
    span.dataset.originalText = originalText;
    span.textContent = originalText;
    return originalText;
  });

  const { text: pageText, map: pageOffsetMap } = buildPageTextIndex(segments);
  const ranges = findExcerptMatchRanges(pageText, excerpt, pageOffsetMap);
  if (ranges.length === 0) return false;

  let offset = 0;

  spans.forEach((span, spanIndex) => {
    const text = segments[spanIndex];
    const spanStart = offset;
    const spanEnd = spanStart + text.length;
    offset = spanEnd;

    const localRanges = ranges
      .filter((range) => range.end > spanStart && range.start < spanEnd)
      .map((range) => ({
        start: Math.max(0, range.start - spanStart),
        end: Math.min(text.length, range.end - spanStart)
      }))
      .filter((range) => range.end > range.start);

    if (localRanges.length === 0) return;

    const mergedRanges: Array<{ start: number; end: number }> = [];
    for (const range of localRanges) {
      const previous = mergedRanges[mergedRanges.length - 1];
      if (!previous || range.start > previous.end) {
        mergedRanges.push({ ...range });
        continue;
      }

      previous.end = Math.max(previous.end, range.end);
    }

    let cursor = 0;
    let html = "";

    for (const range of mergedRanges) {
      if (range.start > cursor) {
        html += escapeHtml(text.slice(cursor, range.start));
      }

      html += `<span class="highlight document-preview__pdf-text-highlight">${escapeHtml(text.slice(
        range.start,
        range.end
      ))}</span>`;
      cursor = range.end;
    }

    if (cursor < text.length) {
      html += escapeHtml(text.slice(cursor));
    }

    span.innerHTML = html;
  });

  return true;
}

function scheduleHighlightAttempts(
  viewer: HTMLDivElement,
  excerpt: string,
  onHighlighted: () => void,
  onDebug?: (state: { spanCount: number; pageText: string; matched: boolean }) => void
): () => void {
  let cancelled = false;
  let observer: MutationObserver | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const cleanup = () => {
    cancelled = true;
    if (observer) observer.disconnect();
    if (timeoutId) clearTimeout(timeoutId);
  };

  const tryApply = () => {
    if (cancelled) return;

    const textLayer = viewer.querySelector<HTMLElement>(".react-pdf__Page__textContent");
    const spans = textLayer ? Array.from(textLayer.querySelectorAll<HTMLElement>("span")) : [];
    const segments = spans.map((span) => span.dataset.originalText ?? span.textContent ?? "");
    const { text: pageText } = buildPageTextIndex(segments);

    const highlighted = applyPdfHighlights(viewer, excerpt);
    onDebug?.({
      spanCount: spans.length,
      pageText,
      matched: highlighted
    });

    if (highlighted) {
      if (observer) observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
      onHighlighted();
      return;
    }

    attempts += 1;
    if (attempts >= 12) {
      if (observer) observer.disconnect();
      return;
    }

    timeoutId = setTimeout(tryApply, 120);
  };

  const textLayer = viewer.querySelector<HTMLElement>(".react-pdf__Page__textContent");
  if (typeof MutationObserver !== "undefined" && textLayer) {
    observer = new MutationObserver(() => {
      tryApply();
    });

    observer.observe(textLayer, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  tryApply();
  return cleanup;
}

export default function DocumentPreview({
  citation,
  onClose,
  onToggleFullscreen,
  isFullscreen = false
}: DocumentPreviewProps) {
  const citationText =
    citation?.citation?.trim() || (citation ? formatCitationLabel(citation) : "No citation");
  const page = formatPageLabel(citation);
  const excerpt = citation?.excerpt || citation?.quote || DEFAULT_VERBATIM_EXCERPT;
  const regulationPdfUrl = resolveRegulationPdfUrl(citation);
  const pdfSourceUrl = regulationPdfUrl ?? DEFAULT_PDF_URL;
  const pageNumber = citation
    ? resolvePdfPage(citation?.page_start || citation?.page)
    : DEFAULT_PDF_PAGE;
  const pageNumbers = useMemo(() => resolvePdfPageRange(citation), [citation]);
  const pdfOpenUrl = resolvePdfOpenUrl(pdfSourceUrl, pageNumber);
  const pdfViewerRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreviewWidth, setPdfPreviewWidth] = useState<number>(PDF_PREVIEW_MIN_WIDTH);
  const [debugPageText, setDebugPageText] = useState("");
  const [debugSpanCount, setDebugSpanCount] = useState(0);
  const [debugFragments, setDebugFragments] = useState<string[]>([]);
  const [debugMatched, setDebugMatched] = useState(false);
  const [pdfTextItems, setPdfTextItems] = useState<PdfTextItem[]>([]);
  const hasAutoScrolledRef = useRef(false);

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

  const highlightedTextItems = useMemo(() => {
    if (!excerpt?.trim() || pdfTextItems.length === 0) {
      return {
        pageText: "",
        matched: false,
        rangesByItem: new Map<number, Array<{ start: number; end: number }>>()
      };
    }

    const { text, map, itemBounds } = buildTextItemIndex(pdfTextItems);
    const matchRanges = expandRangeEdgesToExcerpt(text, excerpt, findExcerptMatchRanges(text, excerpt));
    const rangesByItem = new Map<number, Array<{ start: number; end: number }>>();

    for (const range of matchRanges) {
      const startRef = map[range.start];
      const endRef = map[Math.max(range.start, range.end - 1)];
      if (!startRef || !endRef) continue;

      for (const item of itemBounds) {
        const itemStartRef = map[item.start];
        const itemEndRef = map[Math.max(item.start, item.end - 1)];
        if (!itemStartRef || !itemEndRef) continue;

        if (item.end <= range.start || item.start >= range.end) continue;

        const localStart = Math.max(0, range.start - item.start);
        const localEnd = Math.min(item.text.length, range.end - item.start);
        if (localEnd <= localStart) continue;

        const existing = rangesByItem.get(item.itemIndex) ?? [];
        existing.push({ start: localStart, end: localEnd });
        rangesByItem.set(item.itemIndex, existing);
      }
    }

    return {
      pageText: text,
      matched: matchRanges.length > 0,
      rangesByItem
    };
  }, [excerpt, pdfTextItems]);

  useEffect(() => {
    setDebugFragments(collectExcerptFragments(excerpt));
    setDebugSpanCount(pdfTextItems.length);
    setDebugPageText(highlightedTextItems.pageText);
    setDebugMatched(highlightedTextItems.matched);
  }, [excerpt, highlightedTextItems, pdfTextItems.length]);

  useEffect(() => {
    if (!highlightedTextItems.matched) return;
    if (hasAutoScrolledRef.current) return;
    hasAutoScrolledRef.current = true;
    scrollToFirstHighlight();
  }, [highlightedTextItems.matched, scrollToFirstHighlight]);

  useEffect(() => {
    hasAutoScrolledRef.current = false;
  }, [citation?.id, excerpt, pageNumber, pdfSourceUrl]);

  useEffect(() => {
    setPdfTextItems([]);
  }, [pageNumber, pdfSourceUrl]);

  const renderHighlightedText = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) => {
      const ranges = highlightedTextItems.rangesByItem.get(itemIndex);
      if (!ranges || ranges.length === 0) {
        return escapeHtml(str);
      }

      const mergedRanges: Array<{ start: number; end: number }> = [];
      for (const range of ranges) {
        const previous = mergedRanges[mergedRanges.length - 1];
        if (!previous || range.start > previous.end) {
          mergedRanges.push({ ...range });
          continue;
        }
        previous.end = Math.max(previous.end, range.end);
      }

      let cursor = 0;
      let html = "";

      for (const range of mergedRanges) {
        if (range.start > cursor) {
          html += escapeHtml(str.slice(cursor, range.start));
        }

        html += `<span class="highlight document-preview__pdf-text-highlight">${escapeHtml(
          str.slice(range.start, range.end)
        )}</span>`;
        cursor = range.end;
      }

      if (cursor < str.length) {
        html += escapeHtml(str.slice(cursor));
      }

      return html;
    },
    [highlightedTextItems.rangesByItem]
  );

  return (
    <Panel as="aside" className="workspace-sidebar workspace-sidebar--preview" aria-label="Document preview">
      <header className="sidebar-header document-preview__header">
        <h2 className="chat-shell__title document-preview__title-heading">Source Verification</h2>
        <div className="document-preview__header-actions">
          {onToggleFullscreen ? (
            <button
              type="button"
              className="document-preview__close document-preview__close--icon"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen source verification" : "Open fullscreen source verification"}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <span aria-hidden="true">{isFullscreen ? "↙" : "↗"}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="document-preview__close document-preview__close--icon"
            onClick={onClose}
            aria-label="Close citation drawer"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      <div className="document-preview__content">
        {citation ? (
          <Card as="section" className="document-preview__panel">
            <p className="document-preview__citation">{citationText}</p>
            <p className="document-preview__meta">
              {pageNumbers.length > 1 ? "PDF Pages" : "PDF Page"}: {page}
            </p>
            <blockquote className="document-preview__excerpt">{excerpt}</blockquote>
            <section className="document-preview__pdf-wrap" aria-label="Regulation PDF preview">
              <div ref={pdfViewerRef} className="document-preview__pdf-viewer">
                <Document
                  file={pdfSourceUrl}
                  className="document-preview__pdf-document"
                  loading={<p className="document-preview__pdf-loading">Loading PDF…</p>}
                  error={<p className="document-preview__pdf-loading">Unable to load PDF preview.</p>}
                >
                  {pageNumbers.map((currentPageNumber) => {
                    const isCitationPage = currentPageNumber === pageNumber;

                    return (
                      <div key={currentPageNumber} className="document-preview__pdf-page-wrap">
                        <Page
                          pageNumber={currentPageNumber}
                          width={pdfPreviewWidth}
                          renderAnnotationLayer={false}
                          renderTextLayer
                          customTextRenderer={
                            isCitationPage
                              ? renderHighlightedText
                              : ({ str }: { str: string }) => escapeHtml(str)
                          }
                          className="document-preview__pdf-page"
                          loading={<p className="document-preview__pdf-loading">Loading page…</p>}
                          onGetTextSuccess={
                            isCitationPage
                              ? ({ items }) => {
                                  const textItems: Array<{ str: string; hasEOL?: boolean }> = [];

                                  items.forEach((item) => {
                                    if (!isPdfTextItem(item)) return;
                                    textItems.push(item);
                                  });

                                  const nextItems = textItems.map((item, itemIndex) => ({
                                    str: item.str,
                                    hasEOL: item.hasEOL,
                                    itemIndex
                                  }));

                                  setPdfTextItems((currentItems) =>
                                    arePdfTextItemsEqual(currentItems, nextItems)
                                      ? currentItems
                                      : nextItems
                                  );
                                }
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </Document>
              </div>
              <p className="document-preview__pdf-empty">
                <a
                  href={pdfOpenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="document-preview__open-link"
                >
                  <span>Open the PDF in a new tab</span>
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="document-preview__open-link-icon"
                  >
                    <path
                      d="M5 11 11 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.4 5H11v4.6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </p>
              {SHOW_PDF_DEBUG ? (
                <div className="document-preview__pdf-empty" style={{ textAlign: "left" }}>
                  <p><strong>Debug regulation:</strong> {citation.regulation || "(none)"}</p>
                  <p><strong>Debug citation:</strong> {citation.citation || "(none)"}</p>
                  <p><strong>Debug page:</strong> {citation.page || "(none)"}</p>
                  <p><strong>Debug page_start:</strong> {citation.page_start || "(none)"}</p>
                  <p><strong>Debug page_end:</strong> {citation.page_end || "(none)"}</p>
                  <p><strong>Debug pdf URL:</strong> {pdfSourceUrl}</p>
                  <p><strong>Debug text spans:</strong> {debugSpanCount}</p>
                  <p><strong>Debug matched:</strong> {debugMatched ? "yes" : "no"}</p>
                  <p><strong>Debug excerpt:</strong></p>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      margin: 0,
                      font: "inherit"
                    }}
                  >
                    {excerpt}
                  </pre>
                  <p><strong>Debug match candidates:</strong></p>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      margin: 0,
                      font: "inherit"
                    }}
                  >
                    {debugFragments.join("\n\n---\n\n")}
                  </pre>
                  <p><strong>Debug extracted page text:</strong></p>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      margin: 0,
                      font: "inherit"
                    }}
                  >
                    {debugPageText || "(empty)"}
                  </pre>
                </div>
              ) : null}
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
