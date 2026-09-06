"use server";

import { revalidatePath } from "next/cache";
import { getSql } from "@/lib/db";
import {
  endSession,
  hashPassword,
  passwordProblems,
  requireAdmin,
  requireUser,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

/**
 * Account and user management.
 *
 * Two rules run through all of it:
 *
 *  - a password is never logged, echoed or stored in anything but its hash;
 *  - the last active administrator cannot be removed, demoted or deactivated,
 *    because an internal tool with no way back in is a broken tool.
 *
 * Every change is written to the audit log with who did it and to whom.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const ROLES = ["admin", "analyst"] as const;
type Role = (typeof ROLES)[number];

/** How many active administrators would remain if `excludingId` stopped being one. */
async function otherActiveAdmins(excludingId: number): Promise<number> {
  const sql = getSql();
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM users
    WHERE role = 'admin' AND is_active = true AND id <> ${excludingId}`;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Your own account
// ---------------------------------------------------------------------------

export async function changeOwnPassword(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const sql = getSql();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return { ok: false, message: "The two new passwords do not match." };
  }

  const problems = passwordProblems(newPassword);
  if (problems.length > 0) return { ok: false, message: problems.join(" ") };

  const [row] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!row) return { ok: false, message: "Your account could not be found." };

  // Knowing the current password is what makes this a change rather than a
  // takeover of an unattended, signed-in browser.
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return { ok: false, message: "Your current password is incorrect." };
  }
  if (await verifyPassword(newPassword, row.password_hash)) {
    return { ok: false, message: "The new password must be different from the current one." };
  }

  await sql`
    UPDATE users
    SET password_hash = ${await hashPassword(newPassword)},
        password_changed_at = now(), updated_at = now()
    WHERE id = ${user.id}`;

  await writeAudit({
    actor: user.email,
    action: "user.password_changed",
    entityTable: "users",
    entityId: user.id,
    note: "changed their own password",
  });

  // Every session issued before now is void, including this one — so mint a
  // fresh token rather than signing the user out of the tab they are using.
  await startSession(user);

  revalidatePath("/account");
  return { ok: true, message: "Password changed. Any other signed-in sessions were ended." };
}

// ---------------------------------------------------------------------------
// Administrator actions
// ---------------------------------------------------------------------------

export async function createUser(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const sql = getSql();

  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || email;
  const role = String(formData.get("role") ?? "analyst") as Role;
  const password = String(formData.get("password") ?? "");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!ROLES.includes(role)) return { ok: false, message: "Choose a valid role." };

  const problems = passwordProblems(password);
  if (problems.length > 0) return { ok: false, message: problems.join(" ") };

  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
  if (existing) return { ok: false, message: `${email} already has an account.` };

  const [created] = await sql<{ id: number }[]>`
    INSERT INTO users (email, password_hash, display_name, role)
    VALUES (${email}, ${await hashPassword(password)}, ${displayName}, ${role})
    RETURNING id`;

  await writeAudit({
    actor: admin.email,
    action: "user.created",
    entityTable: "users",
    entityId: created!.id,
    note: `${email} as ${role}`,
  });

  revalidatePath("/users");
  return { ok: true, message: `Created ${email}. Give them the password you just set — they can change it under Your account.` };
}

export async function setUserActive(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const sql = getSql();
  const userId = Number(formData.get("userId"));
  const active = formData.get("active") === "1";

  if (userId === admin.id && !active) {
    return { ok: false, message: "You cannot deactivate your own account." };
  }

  const [target] = await sql<{ email: string; role: Role; is_active: boolean }[]>`
    SELECT email, role, is_active FROM users WHERE id = ${userId}`;
  if (!target) return { ok: false, message: "That account no longer exists." };

  if (!active && target.role === "admin" && (await otherActiveAdmins(userId)) === 0) {
    return {
      ok: false,
      message: "That is the last active administrator. Promote someone else first.",
    };
  }

  await sql`UPDATE users SET is_active = ${active}, updated_at = now() WHERE id = ${userId}`;

  await writeAudit({
    actor: admin.email,
    action: active ? "user.reactivated" : "user.deactivated",
    entityTable: "users",
    entityId: userId,
    fieldChanges: { is_active: { from: target.is_active, to: active } },
    note: target.email,
  });

  revalidatePath("/users");
  return {
    ok: true,
    message: active
      ? `${target.email} can sign in again.`
      : `${target.email} is deactivated and any open session ends immediately.`,
  };
}

export async function setUserRole(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const sql = getSql();
  const userId = Number(formData.get("userId"));
  const role = String(formData.get("role") ?? "") as Role;

  if (!ROLES.includes(role)) return { ok: false, message: "Choose a valid role." };

  const [target] = await sql<{ email: string; role: Role }[]>`
    SELECT email, role FROM users WHERE id = ${userId}`;
  if (!target) return { ok: false, message: "That account no longer exists." };
  if (target.role === role) return { ok: true, message: `${target.email} is already ${role}.` };

  if (target.role === "admin" && role !== "admin" && (await otherActiveAdmins(userId)) === 0) {
    return {
      ok: false,
      message: "That is the last active administrator. Promote someone else first.",
    };
  }

  await sql`UPDATE users SET role = ${role}, updated_at = now() WHERE id = ${userId}`;

  await writeAudit({
    actor: admin.email,
    action: "user.role_changed",
    entityTable: "users",
    entityId: userId,
    fieldChanges: { role: { from: target.role, to: role } },
    note: target.email,
  });

  revalidatePath("/users");
  return { ok: true, message: `${target.email} is now ${role}.` };
}

export async function resetUserPassword(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const sql = getSql();
  const userId = Number(formData.get("userId"));
  const password = String(formData.get("password") ?? "");

  const problems = passwordProblems(password);
  if (problems.length > 0) return { ok: false, message: problems.join(" ") };

  const [target] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`;
  if (!target) return { ok: false, message: "That account no longer exists." };

  await sql`
    UPDATE users
    SET password_hash = ${await hashPassword(password)},
        password_changed_at = now(), updated_at = now()
    WHERE id = ${userId}`;

  await writeAudit({
    actor: admin.email,
    action: "user.password_reset",
    entityTable: "users",
    entityId: userId,
    note: `reset the password for ${target.email}`,
  });

  // An admin resetting their own password invalidates their own session too.
  if (userId === admin.id) {
    await endSession();
  }

  revalidatePath("/users");
  return {
    ok: true,
    message: `Password reset for ${target.email}. Their open sessions have ended.`,
  };
}
