import type { Firestore } from "firebase-admin/firestore";

export interface CitationMetricInput {
  regulation?: string;
  source_id?: string;
}

/** Top-level collection; each metric type is a subcollection under the hub document. */
export const ADMIN_METRICS_COLLECTION = "admin_metrics";

/**
 * Single hub document ID under the collection above. Must differ from the collection name so
 * paths are `admin_metrics/{hub}/question_aggregate_day/…`, not `admin_metrics/admin_metrics/…`.
 */
export const ADMIN_METRICS_ROOT_DOCUMENT_ID = "default";

/**
 * Subcollection IDs under `admin_metrics/default/` (formerly also under a duplicate `admin_metrics` hub doc).
 * Replaces former root-level collections named `admin_metrics_*`.
 */
export const METRIC_SUBCOLLECTIONS = {
  userDay: "user_aggregate_day",
  userMonth: "user_aggregate_month",
  userYear: "user_aggregate_year",
  userProvider: "user_aggregate_provider",
  questionEvents: "question_events",
  questionDay: "question_aggregate_day",
  questionMonth: "question_aggregate_month",
  questionYear: "question_aggregate_year",
  regulationEvents: "regulation_events",
  regulationAggregate: "regulation_aggregate"
} as const;

export type MetricSubcollectionKey = keyof typeof METRIC_SUBCOLLECTIONS;

export function adminMetricCollection(db: Firestore, key: MetricSubcollectionKey) {
  return db
    .collection(ADMIN_METRICS_COLLECTION)
    .doc(ADMIN_METRICS_ROOT_DOCUMENT_ID)
    .collection(METRIC_SUBCOLLECTIONS[key]);
}

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
