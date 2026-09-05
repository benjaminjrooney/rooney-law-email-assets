import type { Sql } from "postgres";
import { hashPassword, passwordProblems } from "@/lib/auth";

/**
 * First-run administrator bootstrap.
 *
 * A fresh deployment has no accounts, and the app is private, so there would be
 * no way in. Running `seed:users` needs a shell or direct database access, which
 * a hosted environment may not offer. So the migration step can create the first
 * administrator from environment variables instead.
 *
 * Deliberately create-if-absent: an existing account is never silently
 * re-passworded just because a variable is still set. `BOOTSTRAP_ADMIN_FORCE=true`
 * is the explicit escape hatch for a forgotten password.
 */
export type BootstrapResult =
  | { status: "skipped"; reason: string }
  | { status: "created"; email: string }
  | { status: "exists"; email: string }
  | { status: "reset"; email: string };

export async function bootstrapAdmin(sql: Sql): Promise<BootstrapResult> {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const displayName = (process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim() || email;
  const force = (process.env.BOOTSTRAP_ADMIN_FORCE ?? "").toLowerCase() === "true";

  if (email === "" || password === "") {
    return { status: "skipped", reason: "BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set" };
  }

  const problems = passwordProblems(password);
  if (problems.length > 0) {
    return {
      status: "skipped",
      reason: `BOOTSTRAP_ADMIN_PASSWORD rejected: ${problems.join(" ")}`,
    };
  }

  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;

  if (existing && !force) {
    return { status: "exists", email };
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash}, display_name = ${displayName},
          role = 'admin', is_active = true, updated_at = now()
      WHERE id = ${existing.id}`;
    await audit(sql, "user.password_reset", existing.id, email);
    return { status: "reset", email };
  }

  const [created] = await sql<{ id: number }[]>`
    INSERT INTO users (email, password_hash, display_name, role)
    VALUES (${email}, ${passwordHash}, ${displayName}, 'admin')
    RETURNING id`;
  await audit(sql, "user.created", created!.id, email);
  return { status: "created", email };
}

async function audit(sql: Sql, action: string, userId: number, email: string): Promise<void> {
  await sql`
    INSERT INTO audit_log (actor, action, entity_table, entity_id, note)
    VALUES ('bootstrap', ${action}, 'users', ${String(userId)},
            ${`${email} (admin) created from BOOTSTRAP_ADMIN_* environment variables`})`;
}
