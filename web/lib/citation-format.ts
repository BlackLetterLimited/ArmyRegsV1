import type { SourceExcerpt } from "./jag-chat";

function normalizeRegulationLabel(value?: string): string {
  const raw = value?.trim();
  if (!raw) return "AR";
  return /^AR\b/i.test(raw) ? raw.replace(/^AR\b/i, "AR") : `AR ${raw}`;
}

function normalizeParagraphLabel(value?: string): string {
  return value?.trim() ?? "";
}

export function formatCitationLabel(source: SourceExcerpt): string {
  const regulation = normalizeRegulationLabel(source.regulation || source.title || "AR");
  const paragraph = normalizeParagraphLabel(source.paragraph);
  const page = source.page?.trim();

  const parts = [regulation];
  if (paragraph) {
    parts.push(`PARA ${paragraph}`);
  }
  if (page) {
    parts.push(`p. ${page}`);
  }

  return parts.join(" · ");
}
