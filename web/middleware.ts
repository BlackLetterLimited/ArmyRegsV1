/**
 * middleware.ts — Next.js Edge Middleware
 *
 * Runs before every request that matches the config.matcher pattern.
 * Protected routes (/chat, /member) require a valid __session cookie.
 * If the cookie is absent, the visitor is redirected to the home page.
 *
 * NOTE: The Edge runtime cannot run the firebase-admin SDK, so we only
 * check for the presence of the cookie here. The actual cryptographic
 * verification happens inside the API route handler and in server
 * components via adminAuth.verifySessionCookie() as needed.
 */

import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "__session";

const PROTECTED_PATHS = ["/chat", "/member"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE_NAME);

  if (!session?.value) {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat/:path*", "/member/:path*"]
};
