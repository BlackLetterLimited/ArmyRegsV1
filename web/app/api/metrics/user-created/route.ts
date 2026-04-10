import { NextRequest, NextResponse } from "next/server";
import { recordUserCreatedMetric } from "../../../../lib/admin-metrics";
import { jsonError } from "../../../../lib/api-response";
import { requireAuthenticatedRequest } from "../../../../lib/server-auth";

export async function POST(request: NextRequest) {
  try {
    const decoded = await requireAuthenticatedRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string;
      createdAt?: string;
      uid?: string;
    };

    const createdAt =
      typeof body.createdAt === "string" && body.createdAt
        ? new Date(body.createdAt)
        : new Date();
    const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

    await recordUserCreatedMetric({
      uid: decoded.uid,
      provider:
        decoded.firebase?.sign_in_provider ??
        (typeof body.provider === "string" ? body.provider : undefined),
      createdAt: safeCreatedAt
    });

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "Unauthorized" ? 401 : 400;
    return jsonError(message, status);
  }
}
