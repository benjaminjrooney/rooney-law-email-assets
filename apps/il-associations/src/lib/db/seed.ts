import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { RULE_SET_V1 } from "@/lib/domain/inclusion";
import { ENTITY_FAMILIES, FILE_KINDS, emptyLayout } from "@/lib/ilsos/layout";
import { inclusionRuleSets, recordLayouts } from "./schema";

/**
 * Reference data an empty database needs.
 *
 * Note what is NOT seeded: any field positions. The six record layouts are
 * created empty and unconfirmed, because this build could not obtain the
 * official ILSOS record-layout documentation and will not guess at it. An
 * operator completes them in the import wizard.
 */
export async function seedReferenceData(
  db: PostgresJsDatabase<Record<string, unknown>>,
): Promise<{ ruleSets: number; layouts: number }> {
  const existingRuleSet = await db
    .select({ id: inclusionRuleSets.id })
    .from(inclusionRuleSets)
    .where(eq(inclusionRuleSets.version, RULE_SET_V1.version))
    .limit(1);

  if (existingRuleSet.length === 0) {
    await db.insert(inclusionRuleSets).values({
      version: RULE_SET_V1.version,
      name: RULE_SET_V1.name,
      notes: RULE_SET_V1.notes,
      rules: RULE_SET_V1.rules,
      isActive: true,
      createdBy: "system",
    });
  }

  let layoutCount = 0;
  for (const family of ENTITY_FAMILIES) {
    for (const fileKind of FILE_KINDS) {
      const existing = await db
        .select({ id: recordLayouts.id })
        .from(recordLayouts)
        .where(and(eq(recordLayouts.family, family), eq(recordLayouts.fileKind, fileKind)))
        .limit(1);
      if (existing.length > 0) {
        layoutCount += 1;
        continue;
      }
      const layout = emptyLayout(family, fileKind);
      await db.insert(recordLayouts).values({
        key: layout.key,
        family: layout.family,
        fileKind: layout.fileKind,
        version: layout.version,
        status: layout.status,
        recordLength: layout.recordLength,
        header: layout.header,
        fields: layout.fields,
        sourceDocument: layout.sourceDocument,
        isActive: true,
      });
      layoutCount += 1;
    }
  }

  const ruleSets = await db.select({ id: inclusionRuleSets.id }).from(inclusionRuleSets);
  return { ruleSets: ruleSets.length, layouts: layoutCount };
}
