"use server";

import { revalidatePath } from "next/cache";
import { getSql } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { normalizeAgentName } from "@/lib/domain/text";
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/domain/classify";
import { refreshAgentCounts } from "@/lib/importer/pipeline";

/**
 * Operator edits to agent organisations.
 *
 * Every one of these writes an `audit_log` row and, where it changes a
 * classification, an `agent_classification_reviews` row. The importer never
 * touches the columns these actions write.
 */

function assertCategory(value: string): AgentCategory {
  if (!AGENT_CATEGORIES.includes(value as AgentCategory)) {
    throw new Error(`Unknown category: ${value}`);
  }
  return value as AgentCategory;
}

type OrgRow = {
  id: number;
  display_name: string | null;
  canonical_source_name: string;
  grouping_key: string;
  automatic_category: AgentCategory;
  override_category: AgentCategory | null;
  override_note: string | null;
};

async function loadOrg(id: number): Promise<OrgRow> {
  const sql = getSql();
  const [row] = await sql<OrgRow[]>`
    SELECT id, display_name, canonical_source_name, grouping_key,
           automatic_category, override_category, override_note
    FROM registered_agent_organizations WHERE id = ${id}`;
  if (!row) throw new Error(`No agent organization with id ${id}.`);
  return row;
}

/** Set or replace the reviewed category for one organisation. */
export async function setAgentOverride(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const id = Number(formData.get("organizationId"));
  const rawCategory = String(formData.get("category") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  const before = await loadOrg(id);
  // An empty selection clears the override and returns to the automatic value.
  const category = rawCategory === "" ? null : assertCategory(rawCategory);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE registered_agent_organizations
      SET override_category = ${category}, override_note = ${note},
          reviewed_by = ${user.email}, reviewed_at = now(), updated_at = now()
      WHERE id = ${id}`;

    await tx`
      INSERT INTO agent_classification_reviews
        (organization_id, action, previous_category, new_category, previous_note, new_note, actor)
      VALUES (${id}, ${category === null ? "clear" : "override"}, ${before.override_category},
              ${category}, ${before.override_note}, ${note}, ${user.email})`;
  });

  await writeAudit({
    actor: user.email,
    action: category === null ? "agent.override_cleared" : "agent.override_set",
    entityTable: "registered_agent_organizations",
    entityId: id,
    fieldChanges: {
      override_category: { from: before.override_category, to: category },
      override_note: { from: before.override_note, to: note },
    },
  });

  revalidatePath(`/agents/${id}`);
  revalidatePath("/review");
  revalidatePath("/");
}

/** Apply one category to many organisations at once. */
export async function bulkSetOverride(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const ids = formData
    .getAll("organizationId")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  const category = assertCategory(String(formData.get("category") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (ids.length === 0) return;

  const existing = await sql<{ id: number; override_category: AgentCategory | null }[]>`
    SELECT id, override_category FROM registered_agent_organizations WHERE id = ANY(${ids})`;

  await sql.begin(async (tx) => {
    await tx`
      UPDATE registered_agent_organizations
      SET override_category = ${category}, override_note = ${note},
          reviewed_by = ${user.email}, reviewed_at = now(), updated_at = now()
      WHERE id = ANY(${ids})`;

    const reviews = existing.map((row) => ({
      organization_id: row.id,
      action: "bulk_override" as const,
      previous_category: row.override_category,
      new_category: category,
      new_note: note,
      actor: user.email,
    }));
    await tx`INSERT INTO agent_classification_reviews ${tx(
      reviews,
      "organization_id",
      "action",
      "previous_category",
      "new_category",
      "new_note",
      "actor",
    )}`;
  });

  await writeAudit({
    actor: user.email,
    action: "agent.bulk_override",
    entityTable: "registered_agent_organizations",
    entityId: ids.join(","),
    note: `${ids.length} organizations set to ${category}`,
  });

  revalidatePath("/review");
  revalidatePath("/");
}

/** Change the display name shown in the UI and exports. */
export async function renameOrganization(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const id = Number(formData.get("organizationId"));
  const displayName = String(formData.get("displayName") ?? "").trim() || null;

  const before = await loadOrg(id);
  await sql`
    UPDATE registered_agent_organizations
    SET display_name = ${displayName}, updated_at = now() WHERE id = ${id}`;

  await sql`
    INSERT INTO agent_classification_reviews (organization_id, action, previous_note, new_note, actor)
    VALUES (${id}, 'rename', ${before.display_name}, ${displayName}, ${user.email})`;

  await writeAudit({
    actor: user.email,
    action: "agent.renamed",
    entityTable: "registered_agent_organizations",
    entityId: id,
    fieldChanges: { display_name: { from: before.display_name, to: displayName } },
  });

  revalidatePath(`/agents/${id}`);
}

/**
 * Approve an alias: an alternative spelling that should roll into this
 * organisation.
 *
 * Nothing merges automatically. Two similar names are routinely different
 * firms, so a person has to say so — and it is recorded who did.
 */
export async function addAlias(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const id = Number(formData.get("organizationId"));
  const aliasName = String(formData.get("aliasName") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (aliasName === "") throw new Error("Enter the exact agent name to alias.");

  const aliasKey = normalizeAgentName(aliasName);
  if (aliasKey === "") throw new Error("That alias has no usable text.");

  const target = await loadOrg(id);
  if (aliasKey === target.grouping_key) {
    throw new Error("That name already normalizes to this organization.");
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO registered_agent_aliases
        (organization_id, alias_exact_name, alias_grouping_key, note, approved_by)
      VALUES (${id}, ${aliasName}, ${aliasKey}, ${note}, ${user.email})
      ON CONFLICT (alias_grouping_key) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        alias_exact_name = EXCLUDED.alias_exact_name,
        note = EXCLUDED.note,
        approved_by = EXCLUDED.approved_by,
        approved_at = now()`;

    // Re-point any roster rows that already carry the aliased grouping key.
    await tx`
      UPDATE associations SET agent_organization_id = ${id}, updated_at = now()
      WHERE agent_grouping_key = ${aliasKey}`;

    // Retire the organisation the alias came from, if one exists.
    await tx`
      UPDATE registered_agent_organizations
      SET merged_into_id = ${id}, association_count = 0, updated_at = now()
      WHERE grouping_key = ${aliasKey} AND id <> ${id}`;

    await tx`
      INSERT INTO agent_classification_reviews (organization_id, action, new_note, actor)
      VALUES (${id}, 'merge', ${`alias approved: ${aliasName}`}, ${user.email})`;
  });

  await refreshAgentCounts(sql);

  await writeAudit({
    actor: user.email,
    action: "agent.alias_approved",
    entityTable: "registered_agent_aliases",
    entityId: id,
    note: `${aliasName} → ${target.grouping_key}`,
  });

  revalidatePath(`/agents/${id}`);
  revalidatePath("/review");
}

/** Remove an approved alias. Roster rows fall back on the next import. */
export async function removeAlias(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const aliasId = Number(formData.get("aliasId"));
  const organizationId = Number(formData.get("organizationId"));

  const [alias] = await sql<{ alias_exact_name: string; alias_grouping_key: string }[]>`
    DELETE FROM registered_agent_aliases WHERE id = ${aliasId}
    RETURNING alias_exact_name, alias_grouping_key`;

  if (alias) {
    await sql`
      UPDATE registered_agent_organizations SET merged_into_id = NULL, updated_at = now()
      WHERE grouping_key = ${alias.alias_grouping_key}`;
    await writeAudit({
      actor: user.email,
      action: "agent.alias_removed",
      entityTable: "registered_agent_aliases",
      entityId: aliasId,
      note: alias.alias_exact_name,
    });
  }

  revalidatePath(`/agents/${organizationId}`);
}
