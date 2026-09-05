import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";

/**
 * The application is private: every route requires a session except the sign-in
 * page and its action, plus the health check Railway polls.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const user = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const target = request.nextUrl.clone();
  target.pathname = "/login";
  // Bring the visitor back to where they were heading after signing in.
  target.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and the favicon. Static files carry
     * no data from the roster, so there is nothing to protect there.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
