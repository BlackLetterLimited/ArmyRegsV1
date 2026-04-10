import { NextRequest, NextResponse } from "next/server";
import { recordChatTurnMetrics } from "../../../../lib/admin-metrics";
import { jsonError } from "../../../../lib/api-response";
import { requireAuthenticatedRequest } from "../../../../lib/server-auth";

interface CitationPayload {
  regulation?: string;
  source_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await requireAuthenticatedRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
      question?: string;
      citations?: CitationPayload[];
      askedAt?: string;
    };

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return jsonError("question is required", 400);
    }

    const citations = Array.isArray(body.citations) ? body.citations : [];
    const parsedAskedAt =
      typeof body.askedAt === "string" && body.askedAt ? new Date(body.askedAt) : new Date();
    const askedAt = Number.isNaN(parsedAskedAt.getTime()) ? new Date() : parsedAskedAt;

    await recordChatTurnMetrics({
      uid: decoded.uid,
      conversationId:
        typeof body.conversationId === "string" && body.conversationId
          ? body.conversationId
          : null,
      question,
      askedAt,
      citations
    });

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "Unauthorized" ? 401 : 400;
    return jsonError(message, status);
  }
}
