import type { DecodedIdToken } from "firebase-admin/auth";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { adminAuth } from "./firebase-admin";

const SESSION_COOKIE_NAME = "__session";

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function verifySessionCookie(sessionCookie: string): Promise<DecodedIdToken | null> {
  try {
    return await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    return null;
  }
}

async function verifyIdToken(idToken: string): Promise<DecodedIdToken | null> {
  try {
    return await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}

export async function getDecodedTokenFromRequest(request: NextRequest): Promise<DecodedIdToken | null> {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const decodedFromSession = await verifySessionCookie(sessionCookie);
    if (decodedFromSession) {
      return decodedFromSession;
    }
  }

  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    return verifyIdToken(bearerToken);
  }

  return null;
}

export async function requireAuthenticatedRequest(request: NextRequest): Promise<DecodedIdToken> {
  const decoded = await getDecodedTokenFromRequest(request);
  if (!decoded) {
    throw new Error("Unauthorized");
  }
  return decoded;
}

export async function requireAdminRequest(request: NextRequest): Promise<DecodedIdToken> {
  const decoded = await requireAuthenticatedRequest(request);
  if (decoded.admin !== true) {
    throw new Error("Forbidden");
  }
  return decoded;
}

export async function getServerSessionUser(): Promise<DecodedIdToken | null> {
  const store = await cookies();
  const sessionCookie = store.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  return verifySessionCookie(sessionCookie);
}

export async function requireServerAdminUser(): Promise<DecodedIdToken> {
  const decoded = await getServerSessionUser();
  if (!decoded) {
    throw new Error("Unauthorized");
  }
  if (decoded.admin !== true) {
    throw new Error("Forbidden");
  }
  return decoded;
}
