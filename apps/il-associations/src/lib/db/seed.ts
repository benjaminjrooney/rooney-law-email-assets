import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { RULE_SET_V1 } from "@/lib/domain/inclusion";
import {
  ENTITY_FAMILIES,
  FILE_KINDS,
  HEADER_TOKENS,
  emptyLayout,
  type EntityFamily,
  type FileKind,
  type LayoutField,
} from "@/lib/ilsos/layout";
import { inclusionRuleSets, recordLayouts } from "./schema";

/**
 * Reference data an empty database needs: Rule Set v1 and the six record
 * layouts.
 *
 * Five of the six layouts are created empty and unconfirmed, because this build
 * could not obtain the official ILSOS record-layout documentation and will not
 * guess at field positions. An operator completes them in the import wizard.
 * The sixth is the exception described immediately below.
 */

/**
 * Layouts established by observation rather than by documentation.
 *
 * The LLC Name file is the one file this build has actually seen. Across all
 * 1,494,050 records of a September 2026 `llcallnam.txt`, every record is an
 * 8-digit file number followed by the legal name running to the end of the
 * record — variable length, CRLF-delimited, no gutter between the two fields,
 * closed by an `END OF FILE RECORD COUNT=` trailer.
 *
 * That is strong enough to seed as `operator_confirmed`, and the citation says
 * exactly what it rests on. It is deliberately NOT marked `documented`: it was
 * derived from the data, not transcribed from the official ILSOS record
 * layout. An operator can re-edit it in the import wizard at any time, and this
 * seed never overwrites a layout that has already been confirmed.
 */
const DERIVED_FROM_DATA =
  "Derived from a September 2026 llcallnam.txt (1,494,050 records, run date 2026-09-04): " +
  "every record is an 8-digit file number followed by the legal name to end of record. " +
  "NOT transcribed from official ILSOS record-layout documentation.";

const DERIVED_LAYOUTS: {
  family: EntityFamily;
  fileKind: FileKind;
  recordLength: number | null;
  fields: LayoutField[];
}[] = [
  {
    family: "llc",
    fileKind: "name",
    // Records are variable length, so there is no fixed record length to set.
    recordLength: null,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "operator_confirmed",
        notes: "All 1,494,050 sampled records carry 8 leading digits here.",
      },
      {
        key: "legal_name",
        label: "Legal entity name",
        start: 9,
        // Longest record observed was 128 characters.
        length: 120,
        role: "legal_name",
        provenance: "operator_confirmed",
        notes: "Runs to the end of the record; the file carries one record per entity.",
      },
    ],
  },
];

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

  // Apply derived layouts, but never over an operator's own confirmation.
  for (const derived of DERIVED_LAYOUTS) {
    const [existing] = await db
      .select({ id: recordLayouts.id, status: recordLayouts.status })
      .from(recordLayouts)
      .where(
        and(
          eq(recordLayouts.family, derived.family),
          eq(recordLayouts.fileKind, derived.fileKind),
        ),
      )
      .limit(1);

    if (!existing || existing.status === "confirmed") continue;

    await db
      .update(recordLayouts)
      .set({
        status: "confirmed",
        recordLength: derived.recordLength,
        fields: derived.fields,
        header: {
          expectToken: HEADER_TOKENS[derived.family][derived.fileKind],
          expectHeader: true,
        },
        sourceDocument: DERIVED_FROM_DATA,
        confirmedBy: "system (derived from source data)",
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(recordLayouts.id, existing.id));
  }

  const ruleSets = await db.select({ id: inclusionRuleSets.id }).from(inclusionRuleSets);
  return { ruleSets: ruleSets.length, layouts: layoutCount };
}
