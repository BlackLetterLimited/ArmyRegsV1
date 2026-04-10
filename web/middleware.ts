import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "__session";

function redirectToHome(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/";
  target.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(target);
}

export function middleware(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSessionCookie) {
    return redirectToHome(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat/:path*", "/member/:path*", "/admin/:path*"]
};
