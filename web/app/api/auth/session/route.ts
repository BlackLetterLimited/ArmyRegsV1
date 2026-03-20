/**
 * POST /api/auth/session
 *   Body: { idToken: string }
 *   Verifies the Firebase ID token with the Admin SDK, then sets an
 *   HTTP-only __session cookie containing a Firebase session cookie
 *   (valid for 5 days). The middleware reads this cookie.
 *
 * DELETE /api/auth/session
 *   Clears the __session cookie on sign-out.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "../../../../lib/firebase-admin";

const SESSION_COOKIE_NAME = "__session";
// 5 days in milliseconds — Firebase session cookies support up to 14 days.
const SESSION_DURATION_MS = 60 * 60 * 24 * 5 * 1000;

export async function POST(request: NextRequest) {
  let idToken: string;

  try {
    const body = (await request.json()) as { idToken?: string };
    if (!body.idToken || typeof body.idToken !== "string") {
      return NextResponse.json({ error: "idToken is required" }, { status: 400 });
    }
    idToken = body.idToken;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // Verify the ID token first so we reject forged tokens immediately.
    const decoded = await adminAuth.verifyIdToken(idToken);

    // Revocation check — if the user has been disabled or their token revoked,
    // this call will throw.
    await adminAuth.getUser(decoded.uid);

    // Create a long-lived session cookie.
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS
    });

    const response = NextResponse.json({ status: "ok" }, { status: 200 });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_DURATION_MS / 1000,
      path: "/"
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ status: "ok" }, { status: 200 });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });
  return response;
}
