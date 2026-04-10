import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "../../../../lib/firebase-admin";
import { jsonError } from "../../../../lib/api-response";
import { assertAdminRequest, toAdminUser } from "../../../../lib/admin-api";

function parseLimit(input: string | null): number {
  const parsed = Number.parseInt(input ?? "50", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 1000);
}

export async function GET(request: NextRequest) {
  try {
    await assertAdminRequest(request);

    const searchParams = request.nextUrl.searchParams;
    const limit = parseLimit(searchParams.get("limit"));
    const pageToken = searchParams.get("pageToken") ?? undefined;
    const query = searchParams.get("q")?.trim().toLowerCase() ?? "";

    const result = await adminAuth.listUsers(limit, pageToken);
    const users = result.users
      .map(toAdminUser)
      .filter((entry) => {
        if (!query) return true;
        return (
          entry.uid.toLowerCase().includes(query) ||
          (entry.email ?? "").toLowerCase().includes(query) ||
          (entry.displayName ?? "").toLowerCase().includes(query)
        );
      });

    return NextResponse.json(
      {
        users,
        nextPageToken: result.pageToken ?? null
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
