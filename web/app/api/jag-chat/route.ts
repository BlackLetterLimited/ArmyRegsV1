import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ||
  process.env.BACKEND_API_BASE_URL ||
  "http://localhost:8000";

export async function POST(request: NextRequest) {
  const url = `${BACKEND_BASE.replace(/\/$/, "")}/api/jag-chat`;
  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const auth = request.headers.get("authorization");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) headers["Authorization"] = auth;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Backend error (${res.status}): ${text}` },
      { status: res.status }
    );
  }

  const stream = res.body;
  if (!stream) {
    return NextResponse.json(
      { error: "Backend returned no body" },
      { status: 502 }
    );
  }

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
