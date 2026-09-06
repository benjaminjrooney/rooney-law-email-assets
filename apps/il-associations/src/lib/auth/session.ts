import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "@/lib/env";

/**
 * Session handling.
 *
 * The session is a signed JWT in an httpOnly, SameSite=Lax cookie. It carries
 * only the user id, email, display name and role — never a password hash and
 * never anything the client should be able to change.
 */

export const SESSION_COOKIE = "il_assoc_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "analyst";
};

/** A decoded session, plus when the token was issued. */
export type DecodedSession = SessionUser & {
  /** Unix seconds the token was signed, or null if the claim was missing. */
  issuedAt: number | null;
};

const key = (): Uint8Array => new TextEncoder().encode(authSecret());

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key());
}

export async function readSessionToken(
  token: string | undefined,
): Promise<DecodedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return null;
    const role = payload.role === "admin" ? "admin" : "analyst";
    return {
      id,
      email: String(payload.email ?? ""),
      displayName: String(payload.displayName ?? ""),
      role,
      issuedAt: typeof payload.iat === "number" ? payload.iat : null,
    };
  } catch {
    // An expired or tampered token is simply "not signed in".
    return null;
  }
}

export const sessionCookieOptions = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
