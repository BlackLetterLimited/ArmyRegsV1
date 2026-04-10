import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import {
  adminMetricCollection,
  getDayKey,
  getMonthKey,
  getYearKey,
  getUniqueCitationPairs,
  makeKey,
  normalizeProvider
} from "./admin-metrics-shared";

type ChatMetricCitation = {
  regulation?: string;
  source_id?: string;
};

interface RecordUserCreatedMetricInput {
  uid: string;
  provider?: string | null;
  createdAt?: Date;
}

interface RecordChatTurnMetricsInput {
  uid: string;
  conversationId?: string | null;
  question: string;
  askedAt?: Date;
  citations: ChatMetricCitation[];
}

function timestampFromDate(input: Date): Timestamp {
  return Timestamp.fromDate(input);
}

export async function recordUserCreatedMetric(input: RecordUserCreatedMetricInput): Promise<void> {
  const createdAt = input.createdAt ?? new Date();
  const provider = normalizeProvider(input.provider);
  const dayKey = getDayKey(createdAt);
  const monthKey = getMonthKey(createdAt);
  const yearKey = getYearKey(createdAt);

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  batch.set(
    adminMetricCollection(adminDb, "userDay").doc(dayKey),
    { key: dayKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminMetricCollection(adminDb, "userMonth").doc(monthKey),
    { key: monthKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminMetricCollection(adminDb, "userYear").doc(yearKey),
    { key: yearKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminMetricCollection(adminDb, "userProvider").doc(makeKey(provider)),
    { key: provider, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminDb.collection("admin_roles").doc(input.uid),
    {
      uid: input.uid,
      provider,
      createdAt: timestampFromDate(createdAt),
      updatedAt: now
    },
    { merge: true }
  );

  await batch.commit();
}

export async function recordChatTurnMetrics(input: RecordChatTurnMetricsInput): Promise<void> {
  const askedAt = input.askedAt ?? new Date();
  const dayKey = getDayKey(askedAt);
  const monthKey = getMonthKey(askedAt);
  const yearKey = getYearKey(askedAt);
  const question = input.question.trim();
  const uniquePairs = getUniqueCitationPairs(input.citations);
  const questionEventRef = adminMetricCollection(adminDb, "questionEvents").doc();
  const now = FieldValue.serverTimestamp();
  const questionAskedAt = timestampFromDate(askedAt);

  const batch = adminDb.batch();
  batch.set(questionEventRef, {
    uid: input.uid,
    conversationId: input.conversationId ?? null,
    question,
    askedAt: questionAskedAt,
    dayKey,
    monthKey,
    yearKey,
    createdAt: now
  });
  batch.set(
    adminMetricCollection(adminDb, "questionDay").doc(dayKey),
    { key: dayKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminMetricCollection(adminDb, "questionMonth").doc(monthKey),
    { key: monthKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );
  batch.set(
    adminMetricCollection(adminDb, "questionYear").doc(yearKey),
    { key: yearKey, count: FieldValue.increment(1), updatedAt: now },
    { merge: true }
  );

  for (const pair of uniquePairs) {
    const regulationKey = makeKey(pair.regulation);
    const sourceKey = makeKey(pair.sourceId);
    const eventRef = adminMetricCollection(adminDb, "regulationEvents").doc();
    const regulationRef = adminMetricCollection(adminDb, "regulationAggregate").doc(regulationKey);
    const sourceRef = regulationRef.collection("sources").doc(sourceKey);

    batch.set(eventRef, {
      uid: input.uid,
      conversationId: input.conversationId ?? null,
      regulation: pair.regulation,
      sourceId: pair.sourceId,
      question,
      askedAt: questionAskedAt,
      dayKey,
      monthKey,
      yearKey,
      createdAt: now
    });
    batch.set(
      regulationRef,
      {
        regulation: pair.regulation,
        regulationKey,
        count: FieldValue.increment(1),
        updatedAt: now
      },
      { merge: true }
    );
    batch.set(
      sourceRef,
      {
        sourceId: pair.sourceId,
        sourceKey,
        regulation: pair.regulation,
        count: FieldValue.increment(1),
        updatedAt: now
      },
      { merge: true }
    );
  }

  await batch.commit();
}
