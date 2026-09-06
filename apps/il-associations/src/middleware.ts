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
     * Everything except Next's own assets and the app icons. Static files carry
     * no data from the roster, so there is nothing to protect there.
     *
     * The icons have to be listed by name. They are routes like any other, so
     * without this a signed-out browser asking for the tab icon is redirected to
     * /login and the login page — the one page a signed-out visitor sees — shows
     * no mark at all. This was already true of the icon that preceded them.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
