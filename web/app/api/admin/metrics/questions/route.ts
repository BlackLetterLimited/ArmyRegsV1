import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../../lib/firebase-admin";
import { assertAdminRequest } from "../../../../../lib/admin-api";
import { jsonError } from "../../../../../lib/api-response";
import { METRIC_COLLECTIONS } from "../../../../../lib/admin-metrics-shared";

interface AggregatePoint {
  key: string;
  count: number;
}

function mapAggregate(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]
): AggregatePoint[] {
  return docs
    .map((doc) => {
      const data = doc.data();
      return {
        key: typeof data.key === "string" ? data.key : doc.id,
        count: typeof data.count === "number" ? data.count : 0
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function GET(request: NextRequest) {
  try {
    await assertAdminRequest(request);
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number.parseInt(limitParam ?? "200", 10) || 200, 1), 500);

    const [daySnap, monthSnap, yearSnap, eventSnap] = await Promise.all([
      adminDb.collection(METRIC_COLLECTIONS.questionDay).get(),
      adminDb.collection(METRIC_COLLECTIONS.questionMonth).get(),
      adminDb.collection(METRIC_COLLECTIONS.questionYear).get(),
      adminDb
        .collection(METRIC_COLLECTIONS.questionEvents)
        .orderBy("askedAt", "desc")
        .limit(limit)
        .get()
    ]);

    const events = eventSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: typeof data.uid === "string" ? data.uid : "",
        conversationId: typeof data.conversationId === "string" ? data.conversationId : null,
        question: typeof data.question === "string" ? data.question : "",
        askedAt:
          data.askedAt && typeof data.askedAt.toDate === "function"
            ? data.askedAt.toDate().toISOString()
            : null
      };
    });

    return NextResponse.json(
      {
        daily: mapAggregate(daySnap.docs),
        monthly: mapAggregate(monthSnap.docs),
        yearly: mapAggregate(yearSnap.docs),
        events
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
