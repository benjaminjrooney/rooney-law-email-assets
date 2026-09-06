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
 * The LLC Name layout was derived before the documentation was available.
 *
 * Across all 1,494,050 records of a September 2026 `llcallnam.txt`, every record
 * read as an 8-digit file number followed by the legal name to end of record.
 * It was seeded `operator_confirmed` with a citation saying exactly that.
 *
 * The document has since arrived and says the same thing: LL-NAME is X(120) at
 * 009–128 on a 128-character record. The derivation was right to the character,
 * and llc/name is now seeded from the document like the rest, so nothing in the
 * database rests on an inference any more. Kept as a note because it is the one
 * layout with independent confirmation from two directions.
 */

/**
 * Layouts transcribed from the official ILSOS record-layout documentation.
 *
 * Source: "PROCEDURES TO ACCESS CORP DATA", Illinois Secretary of State,
 * version 004 (2024-04-04), section RECORD DESCRIPTIONS, retrieved from
 * https://www.ilsos.gov/content/dam/data/bs/proc_corp_data.pdf
 *
 * These are `documented` — copied field by field from that document, including
 * its COBOL names, not inferred from any file. Positions in the document are
 * 1-based inclusive ranges; `length` here is the width those ranges imply.
 *
 * Fields the document defines but this application has no semantic slot for
 * keep `role: "unmapped"` while still carrying `provenance: "documented"`. That
 * pair is deliberate and means what it says: the position and the source name
 * are documented, the application simply does not interpret the value. Their
 * raw contents are retained on the record.
 *
 * The equivalent LLC document is a separate publication this build has not
 * seen, so llc/agent and llc/master remain unconfirmed.
 */
const CORP_DOC = "ILSOS “Procedures to Access Corp Data”, v004 (2024-04-04), RECORD DESCRIPTIONS.";
const LLC_DOC = "ILSOS “Procedures to Access LL Data”, v004 (2024-04-04), RECORD DESCRIPTIONS.";

export const DOCUMENTED_LAYOUTS: {
  family: EntityFamily;
  fileKind: FileKind;
  recordLength: number;
  /** The document this layout came from. The two families have different ones. */
  document: string;
  fields: LayoutField[];
}[] = [
  {
    family: "cdx",
    fileKind: "name",
    document: CORP_DOC,
    // "The Name record types will be transmitted in fixed-length ... records."
    recordLength: 197,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41001 CORP-FILE-NUMBER 9(08) 001–008. Last digit is a modulus-11 check digit.",
      },
      {
        key: "legal_name",
        label: "Legal entity name",
        start: 9,
        length: 189,
        role: "legal_name",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41051 CORP-NAME X(189) 009–197.",
      },
    ],
  },
  {
    family: "cdx",
    fileKind: "agent",
    document: CORP_DOC,
    recordLength: 164,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41001 CORP-FILE-NUMBER 9(08) 001–008.",
      },
      {
        key: "agent_name",
        label: "Registered agent name",
        start: 9,
        length: 60,
        role: "agent_name",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41049 CORP-AGENT-NAME X(60) 009–068.",
      },
      {
        key: "agent_street",
        label: "Agent street",
        start: 69,
        length: 45,
        role: "agent_street",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41099 CORP-AGENT-STREET X(45) 069–113.",
      },
      {
        key: "agent_city",
        label: "Agent city",
        start: 114,
        length: 30,
        role: "agent_city",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41102 CORP-AGENT-CITY X(30) 114–143.",
      },
      {
        key: "agent_change_date",
        label: "Agent change date",
        start: 144,
        length: 8,
        role: "agent_change_date",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes:
          "41034 CORP-AGENT-CHANGE-DATE 9(08) 144–151. Holds the incorporated date until the first agent change.",
      },
      {
        key: "agent_code",
        label: "Agent code (individual or named commercial agent)",
        start: 152,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes:
          "41035 CORP-AGENT-CODE X(01) 152–152. 0 individual; 1 CT Corporation System; 2 Cogency Global; " +
          "3 Prentice-Hall; 4 US Corporation Co; 5 Illinois Corporation Service Company; " +
          "6 National Registered Agents; 8 vacate pending; 9 vacated. Retained but not yet used by classification.",
      },
      {
        key: "agent_zip",
        label: "Agent ZIP",
        start: 153,
        length: 9,
        role: "agent_zip",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41036 CORP-AGENT-ZIP 9(09) 153–161.",
      },
      {
        key: "agent_county",
        label: "Agent county code",
        start: 162,
        length: 3,
        role: "agent_county",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41037 CORP-AGENT-COUNTY-CODE 9(03) 162–164.",
      },
    ],
  },
  {
    family: "cdx",
    fileKind: "master",
    document: CORP_DOC,
    recordLength: 160,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41001 CORP-FILE-NUMBER 9(08) 001–008.",
      },
      {
        key: "incorp_date",
        label: "Incorporation date",
        start: 9,
        length: 8,
        role: "organization_date",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41002 CORP-INCORP-DATE 9(08) 009–016, CCYYMMDD.",
      },
      {
        key: "extended_date",
        label: "Extended date",
        start: 17,
        length: 8,
        role: "extended_date",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41110 CORP-EXTENDED-DATE 9(08) 017–024.",
      },
      {
        key: "state_code",
        label: "State code",
        start: 25,
        length: 2,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41003 CORP-STATE-CODE 9(02) 025–026. DoIT standard numeric state code.",
      },
      {
        key: "corp_intent",
        label: "Corporate intent code",
        start: 27,
        length: 3,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41005 CORP-CORP-INTENT 9(03) 027–029. Type of business transacted in Illinois.",
      },
      {
        key: "status_code",
        label: "Entity status",
        start: 30,
        length: 2,
        role: "status_code",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41006 CORP-STATUS 9(02) 030–031. Codes 00–17; see src/lib/ilsos/status-codes.ts.",
      },
      {
        key: "entity_type_code",
        label: "Corporation type",
        start: 32,
        length: 1,
        role: "entity_type_code",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes:
          "41007 CORP-TYPE-CORP 9(01) 032–032. 2 summons not qualified; 3 registration name only; " +
          "4 domestic BCA; 5 not-for-profit; 6 foreign BCA.",
      },
      {
        key: "trans_date",
        label: "Transaction date",
        start: 33,
        length: 8,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes:
          "41008 CORP-TRANS-DATE 9(08) 033–040. Left unmapped rather than read as the effective date, " +
          "which the document does not say it is.",
      },
      {
        key: "president_name_address",
        label: "President name and address",
        start: 41,
        length: 60,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes: "41050 CORP-PRES-NAME-ADDR X(60) 041–100.",
      },
      {
        key: "secretary_name_address",
        label: "Secretary name and address",
        start: 101,
        length: 60,
        role: "unmapped",
        provenance: "documented",
        documentedBy: CORP_DOC,
        notes:
          "41098 CORP-SEC-NAME-ADDR X(60) 101–160. On statuses 04, 06, 07, 08, 09, 10 and 12 this instead " +
          "holds a literal in positions 1–24 and a transaction date in 25–32, with a surviving file number " +
          "from position 35 when merged or consolidated.",
      },
    ],
  },
  {
    family: "llc",
    fileKind: "name",
    document: LLC_DOC,
    // "The Name record types will be transmitted in fixed-length one hundred
    // and twenty-eight (128) character records."
    recordLength: 128,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42001 LL-FILE-NUMBER 9(08) 001–008. Last digit is a modulus-11 check digit.",
      },
      {
        key: "legal_name",
        label: "Legal entity name",
        start: 9,
        length: 120,
        role: "legal_name",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42028 LL-NAME X(120) 009–128.",
      },
    ],
  },
  {
    family: "llc",
    fileKind: "agent",
    document: LLC_DOC,
    recordLength: 164,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42001 LL-FILE-NUMBER 9(08) 001–008.",
      },
      {
        key: "agent_code",
        label: "Agent code (individual or named commercial agent)",
        start: 9,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42002 LL-AGENT-CODE X(01) 009–009. Same code list as a corporation record but at a different position. Retained, not yet used by classification.",
      },
      {
        key: "agent_name",
        label: "Registered agent name",
        start: 10,
        length: 60,
        role: "agent_name",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42003 LL-AGENT-NAME X(60) 010–069.",
      },
      {
        key: "agent_street",
        label: "Agent street",
        start: 70,
        length: 45,
        role: "agent_street",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42004 LL-AGENT-STREET X(45) 070–114.",
      },
      {
        key: "agent_city",
        label: "Agent city",
        start: 115,
        length: 30,
        role: "agent_city",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42005 LL-AGENT-CITY X(30) 115–144.",
      },
      {
        key: "agent_zip",
        label: "Agent ZIP",
        start: 145,
        length: 9,
        role: "agent_zip",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42006 LL-AGENT-ZIP 9(09) 145–153.",
      },
      {
        key: "agent_county",
        label: "Agent county code",
        start: 154,
        length: 3,
        role: "agent_county",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42007 LL-AGENT-COUNTY-CODE 9(03) 154–156.",
      },
      {
        key: "agent_change_date",
        label: "Agent change date",
        start: 157,
        length: 8,
        role: "agent_change_date",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42008 LL-AGENT-CHANGE-DATE 9(08) 157–164. Holds the organisation date until the first agent change.",
      },
    ],
  },
  {
    family: "llc",
    fileKind: "master",
    document: LLC_DOC,
    recordLength: 136,
    fields: [
      {
        key: "file_number",
        label: "Illinois file number",
        start: 1,
        length: 8,
        role: "file_number",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42001 LL-FILE-NUMBER 9(08) 001–008.",
      },
      {
        key: "purpose_code",
        label: "Purpose code",
        start: 9,
        length: 6,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42009 LL-PURPOSE-CODE 9(06) 009–014. The business code from IRS Form 1065.",
      },
      {
        key: "status_code",
        label: "Entity status",
        start: 15,
        length: 2,
        role: "status_code",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42010 LL-STATUS-CODE 9(02) 015–016. Codes 00–14; see src/lib/ilsos/status-codes.ts. Not the same table as a corporation.",
      },
      {
        key: "status_date",
        label: "Status date",
        start: 17,
        length: 8,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42011 LL-STATUS-DATE 9(08) 017–024. Date the current status was attained; the organisation date on a new LLC.",
      },
      {
        key: "organized_date",
        label: "Organisation date",
        start: 25,
        length: 8,
        role: "organization_date",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42012 LL-ORGANIZED-DATE 9(08) 025–032. Date organised to do business in Illinois, which for a foreign LLC need not be its original jurisdiction date.",
      },
      {
        key: "dissolution_date",
        label: "Dissolution date",
        start: 33,
        length: 8,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42013 LL-DISSOLUTION-DATE 9(08) 033–040. The latest date on which the LLC is to dissolve.",
      },
      {
        key: "management_type",
        label: "Management type",
        start: 41,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42014 LL-MANAGEMENT-TYPE 9(01) 041–041. 0 none selected (foreign only); 1 member managed; 2 manager managed; 3 both.",
      },
      {
        key: "juris_organized",
        label: "Jurisdiction organised",
        start: 42,
        length: 2,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42016 LL-JURIS-ORGANIZED X(02) 042–043. Two-letter state, or a numeric country code.",
      },
      {
        key: "records_office_street",
        label: "Records office street",
        start: 44,
        length: 45,
        role: "registered_office_street",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42017 LL-RECORDS-OFF-STREET X(45) 044–088. Where the LLC keeps its records under the LLC Act.",
      },
      {
        key: "records_office_city",
        label: "Records office city",
        start: 89,
        length: 30,
        role: "registered_office_city",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42018 LL-RECORDS-OFF-CITY X(30) 089–118.",
      },
      {
        key: "records_office_zip",
        label: "Records office ZIP",
        start: 119,
        length: 9,
        role: "registered_office_zip",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42019 LL-RECORDS-OFF-ZIP X(09) 119–127.",
      },
      {
        key: "records_office_juris",
        label: "Records office jurisdiction",
        start: 128,
        length: 2,
        role: "registered_office_state",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42016 LL-RECORDS-OFF-JURIS X(02) 128–129. Two-letter state in the ordinary case; the document allows a numeric country code here too.",
      },
      {
        key: "assumed_ind",
        label: "Assumed-name indicator",
        start: 130,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42020 LL-ASSUMED-IND 9(01) 130. 0 none; 1 assumed name on file.",
      },
      {
        key: "old_ind",
        label: "Old-name indicator",
        start: 131,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42021 LL-OLD-IND 9(01) 131.",
      },
      {
        key: "provisions_ind",
        label: "Provisions indicator",
        start: 132,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42022 LL-PROVISIONS-IND 9(01) 132.",
      },
      {
        key: "opt_ind",
        label: "Optional-provisions indicator",
        start: 133,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42086 LL-OPT-IND 9(01) 133.",
      },
      {
        key: "series_ind",
        label: "Series indicator",
        start: 134,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42103 LL-SERIES-IND X(01) 134.",
      },
      {
        key: "uap_ind",
        label: "UAP indicator",
        start: 135,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42107 LL-UAP-IND X(01) 135.",
      },
      {
        key: "l3c_ind",
        label: "L3C indicator",
        start: 136,
        length: 1,
        role: "unmapped",
        provenance: "documented",
        documentedBy: LLC_DOC,
        notes: "42106 LL-L3C-IND X(01) 136.",
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

  // Apply documented layouts, on the same terms: never over an operator's own
  // confirmation. These carry the official citation rather than a derivation
  // note, because they were transcribed from the published record layout.
  for (const documented of DOCUMENTED_LAYOUTS) {
    const [existing] = await db
      .select({
        id: recordLayouts.id,
        status: recordLayouts.status,
        confirmedBy: recordLayouts.confirmedBy,
      })
      .from(recordLayouts)
      .where(
        and(
          eq(recordLayouts.family, documented.family),
          eq(recordLayouts.fileKind, documented.fileKind),
        ),
      )
      .limit(1);

    if (!existing) continue;
    /*
     * An operator's own confirmation is never overwritten. A confirmation this
     * seed made itself is, so a layout that was derived from data before the
     * documentation existed picks up the documented positions and the real
     * citation on the next migration instead of keeping a stale provenance.
     */
    const ours = existing.confirmedBy?.startsWith("system") ?? false;
    if (existing.status === "confirmed" && !ours) continue;

    await db
      .update(recordLayouts)
      .set({
        status: "confirmed",
        recordLength: documented.recordLength,
        fields: documented.fields,
        header: {
          expectToken: HEADER_TOKENS[documented.family][documented.fileKind],
          expectHeader: true,
        },
        sourceDocument: documented.document,
        confirmedBy: "system (transcribed from ILSOS documentation)",
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(recordLayouts.id, existing.id));
  }

  const ruleSets = await db.select({ id: inclusionRuleSets.id }).from(inclusionRuleSets);
  return { ruleSets: ruleSets.length, layouts: layoutCount };
}
