import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "../../../../../lib/firebase-admin";
import { assertAdminRequest } from "../../../../../lib/admin-api";
import { jsonError } from "../../../../../lib/api-response";
import { METRIC_COLLECTIONS } from "../../../../../lib/admin-metrics-shared";

interface RegulationAggregate {
  regulation: string;
  count: number;
  sources: Array<{ sourceId: string; count: number }>;
}

export async function GET(request: NextRequest) {
  try {
    await assertAdminRequest(request);
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number.parseInt(limitParam ?? "20", 10) || 20, 1), 200);

    const [aggregateSnap, eventSnap] = await Promise.all([
      adminDb.collection(METRIC_COLLECTIONS.regulationAggregate).get(),
      adminDb
        .collection(METRIC_COLLECTIONS.regulationEvents)
        .orderBy("askedAt", "desc")
        .limit(500)
        .get()
    ]);

    const aggregates = (
      await Promise.all(
        aggregateSnap.docs.map(async (doc) => {
          const data = doc.data();
          const regulation = typeof data.regulation === "string" ? data.regulation : doc.id;
          const count = typeof data.count === "number" ? data.count : 0;
          const sourceSnap = await doc.ref.collection("sources").get();
          const sources = sourceSnap.docs
            .map((entry) => {
              const sourceData = entry.data();
              return {
                sourceId:
                  typeof sourceData.sourceId === "string" ? sourceData.sourceId : entry.id,
                count: typeof sourceData.count === "number" ? sourceData.count : 0
              };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          const aggregate: RegulationAggregate = { regulation, count, sources };
          return aggregate;
        })
      )
    )
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const recentEvents = eventSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        regulation: typeof data.regulation === "string" ? data.regulation : "unknown",
        sourceId: typeof data.sourceId === "string" ? data.sourceId : "unknown",
        uid: typeof data.uid === "string" ? data.uid : "",
        question: typeof data.question === "string" ? data.question : "",
        askedAt:
          data.askedAt && typeof data.askedAt.toDate === "function"
            ? data.askedAt.toDate().toISOString()
            : null
      };
    });

    return NextResponse.json({ aggregates, recentEvents }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
