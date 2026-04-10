import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "../../../../../../lib/firebase-admin";
import { jsonError } from "../../../../../../lib/api-response";
import { assertAdminRequest } from "../../../../../../lib/admin-api";

interface RouteContext {
  params: Promise<{ uid: string }>;
}

async function sendPasswordResetEmail(email: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is required to send password reset emails.");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email
      })
    }
  );

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Failed to send password reset email: ${payload || response.statusText}`);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await assertAdminRequest(request);
    const { uid } = await context.params;
    const user = await adminAuth.getUser(uid);
    if (!user.email) {
      return jsonError("Selected user does not have an email address.", 400);
    }

    await sendPasswordResetEmail(user.email);
    const link = await adminAuth.generatePasswordResetLink(user.email);

    return NextResponse.json(
      {
        status: "ok",
        email: user.email,
        generatedLink: link
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send password reset";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return jsonError(message, status);
  }
}
