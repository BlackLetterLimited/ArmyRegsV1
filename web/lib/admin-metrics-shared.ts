export interface CitationMetricInput {
  regulation?: string;
  source_id?: string;
}

export const METRIC_COLLECTIONS = {
  userDay: "admin_metrics_user_aggregate_day",
  userMonth: "admin_metrics_user_aggregate_month",
  userYear: "admin_metrics_user_aggregate_year",
  userProvider: "admin_metrics_user_aggregate_provider",
  questionEvents: "admin_metrics_question_events",
  questionDay: "admin_metrics_question_aggregate_day",
  questionMonth: "admin_metrics_question_aggregate_month",
  questionYear: "admin_metrics_question_aggregate_year",
  regulationEvents: "admin_metrics_regulation_events",
  regulationAggregate: "admin_metrics_regulation_aggregate"
} as const;

export function getDayKey(input: Date): string {
  return input.toISOString().slice(0, 10);
}

export function getMonthKey(input: Date): string {
  return input.toISOString().slice(0, 7);
}

export function getYearKey(input: Date): string {
  return String(input.getUTCFullYear());
}

export function normalizeProvider(provider?: string | null): string {
  if (!provider) return "unknown";
  const trimmed = provider.trim().toLowerCase();
  if (!trimmed) return "unknown";
  if (trimmed === "password") return "email";
  if (trimmed === "google.com") return "google";
  if (trimmed === "facebook.com") return "facebook";
  return trimmed;
}

export function makeKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

export function normalizeRegulation(value?: string | null): string {
  if (!value) return "unknown";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

export function normalizeSourceId(value?: string | null): string {
  if (!value) return "unknown";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

export function getUniqueCitationPairs(citations: CitationMetricInput[]): Array<{ regulation: string; sourceId: string }> {
  const dedupe = new Set<string>();
  const pairs: Array<{ regulation: string; sourceId: string }> = [];

  for (const citation of citations) {
    const regulation = normalizeRegulation(citation.regulation);
    const sourceId = normalizeSourceId(citation.source_id);
    const key = `${regulation}::${sourceId}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    pairs.push({ regulation, sourceId });
  }

  return pairs;
}
