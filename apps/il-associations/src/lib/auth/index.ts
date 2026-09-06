import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { isProduction } from "@/lib/env";
import {
  SESSION_COOKIE,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
  type SessionUser,
} from "./session";

/** Cost factor for password hashing. */
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum password policy for seeded, changed and reset passwords. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < 12) problems.push("Password must be at least 12 characters.");
  if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain)) {
    problems.push("Password must contain both upper and lower case letters.");
  }
  if (!/[0-9]/.test(plain)) problems.push("Password must contain a digit.");
  return problems;
}

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; message: string };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const sql = getSql();
  const [row] = await sql<
    {
      id: number;
      email: string;
      password_hash: string;
      display_name: string;
      role: "admin" | "analyst";
      is_active: boolean;
    }[]
  >`
    SELECT id, email, password_hash, display_name, role, is_active
    FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;

  // The same message for an unknown address and a wrong password, and the hash
  // comparison still runs, so the response does not reveal which accounts exist.
  const fallbackHash = "$2a$12$" + "x".repeat(53);
  const matches = await verifyPassword(password, row?.password_hash ?? fallbackHash).catch(
    () => false,
  );

  if (!row || !matches || !row.is_active) {
    return { ok: false, message: "Email address or password is incorrect." };
  }

  await sql`UPDATE users SET last_login_at = now() WHERE id = ${row.id}`;

  return {
    ok: true,
    user: { id: row.id, email: row.email, displayName: row.display_name, role: row.role },
  };
}

export async function startSession(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(isProduction()));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, checked against the database.
 *
 * The cookie alone is not trusted for authorisation. A signed token stays valid
 * until it expires, so without this check a deactivated account would keep
 * working for the rest of its session, a demoted admin would keep admin powers,
 * and a changed password would not lock out whoever knew the old one. Each of
 * those is settled here:
 *
 *  - the account must still exist and still be active;
 *  - the token must have been issued at or after `password_changed_at`;
 *  - the role comes from the row, not from the token.
 *
 * Costs one indexed lookup per request, which is the right trade for an
 * internal tool holding a firm's market analysis.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const sql = getSql();
  const [row] = await sql<
    {
      id: number;
      email: string;
      display_name: string;
      role: "admin" | "analyst";
      is_active: boolean;
      password_changed_at: Date;
    }[]
  >`
    SELECT id, email, display_name, role, is_active, password_changed_at
    FROM users WHERE id = ${session.id} LIMIT 1`;

  if (!row || !row.is_active) return null;

  if (session.issuedAt !== null) {
    // One second of slack: the token's issued-at has second precision, so a
    // token minted in the same second as the change would otherwise be refused.
    const changedAt = Math.floor(new Date(row.password_changed_at).getTime() / 1000);
    if (session.issuedAt < changedAt - 1) return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export class NotAuthorizedError extends Error {}

/** Guard for operations reserved to administrators. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new NotAuthorizedError("This action requires an administrator account.");
  }
  return user;
}
