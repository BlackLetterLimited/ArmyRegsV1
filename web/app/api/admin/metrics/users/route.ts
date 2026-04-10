import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../../lib/firebase-admin";
import { assertAdminRequest } from "../../../../../lib/admin-api";
import { jsonError } from "../../../../../lib/api-response";
import { METRIC_COLLECTIONS } from "../../../../../lib/admin-metrics-shared";

interface AggregatePoint {
  key: string;
  count: number;
}

function toAggregatePoints(
  docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]
): AggregatePoint[] {
  return docs
    .map((doc) => {
      const data = doc.data();
      const key = typeof data.key === "string" ? data.key : doc.id;
      const count = typeof data.count === "number" ? data.count : 0;
      return { key, count };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function GET(request: NextRequest) {
  try {
    await assertAdminRequest(request);
    const [daySnap, monthSnap, yearSnap, providerSnap] = await Promise.all([
      adminDb.collection(METRIC_COLLECTIONS.userDay).get(),
      adminDb.collection(METRIC_COLLECTIONS.userMonth).get(),
      adminDb.collection(METRIC_COLLECTIONS.userYear).get(),
      adminDb.collection(METRIC_COLLECTIONS.userProvider).get()
    ]);

    const daily = toAggregatePoints(daySnap.docs);
    const monthly = toAggregatePoints(monthSnap.docs);
    const yearly = toAggregatePoints(yearSnap.docs);
    const providers = toAggregatePoints(providerSnap.docs).sort((a, b) => b.count - a.count);

    return NextResponse.json(
      {
        daily,
        monthly,
        yearly,
        providers
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
