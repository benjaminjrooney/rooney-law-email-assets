import { randomBytes } from "node:crypto";
import { closeDb, getSql } from "@/lib/db";
import { hashPassword, passwordProblems } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

/**
 * Create or update an application account.
 *
 *   npm run seed:users -- --email ben@example.com --name "Ben Rooney" --role admin
 *
 * The password comes from --password or the SEED_PASSWORD environment variable.
 * With neither, a strong one is generated and printed once.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function generatePassword(): string {
  // 24 URL-safe characters, then guaranteed to satisfy the policy.
  return randomBytes(18).toString("base64url") + "Aa1";
}

async function main(): Promise<void> {
  const email = arg("email") ?? process.env.SEED_EMAIL;
  const name = arg("name") ?? process.env.SEED_NAME ?? email;
  const role = (arg("role") ?? process.env.SEED_ROLE ?? "admin") as "admin" | "analyst";

  if (!email) {
    throw new Error("Provide --email (or SEED_EMAIL).");
  }
  if (role !== "admin" && role !== "analyst") {
    throw new Error("--role must be admin or analyst.");
  }

  let password = arg("password") ?? process.env.SEED_PASSWORD;
  let generated = false;
  if (!password) {
    password = generatePassword();
    generated = true;
  }

  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new Error(`Password rejected:\n- ${problems.join("\n- ")}`);
  }

  const sql = getSql();
  const passwordHash = await hashPassword(password);

  const [row] = await sql<{ id: number; created: boolean }[]>`
    INSERT INTO users (email, password_hash, display_name, role)
    VALUES (${email}, ${passwordHash}, ${name ?? email}, ${role})
    ON CONFLICT (lower(email)) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      is_active = true,
      updated_at = now()
    RETURNING id, (xmax = 0) AS created`;

  await writeAudit(
    {
      actor: "seed-users",
      action: row!.created ? "user.created" : "user.password_reset",
      entityTable: "users",
      entityId: row!.id,
      note: `${email} (${role})`,
    },
    sql,
  );

  console.log(`${row!.created ? "Created" : "Updated"} ${email} as ${role}.`);
  if (generated) {
    console.log(`\nGenerated password (shown once):\n\n    ${password}\n`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
