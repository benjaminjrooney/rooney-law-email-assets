import { Readable } from "node:stream";
import type { RecordLayout } from "@/lib/ilsos/layout";

/**
 * Small synthetic ILSOS-shaped fixtures.
 *
 * These are NOT the official file layouts — the official record-layout
 * documentation is not reproduced here. They are invented fixed-width shapes
 * used purely to exercise the parser, the joiner and the importer, and their
 * layouts are marked `operator_confirmed` so the tests can drive a write-mode
 * import the way a real operator would after confirming a real layout.
 */

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

export const FIXTURE_RUN_DATE = "2026-09-01";

// ---------------------------------------------------------------- NAME file
// 1-8 file number | 9 gutter | 10-69 legal name
export const NAME_RECORD_LENGTH = 69;

export const nameLayout = (family: "llc" | "cdx"): RecordLayout => ({
  key: `${family}-name`,
  family,
  fileKind: "name",
  version: 1,
  status: "confirmed",
  recordLength: NAME_RECORD_LENGTH,
  header: { expectToken: `${family}allnam`, expectHeader: true },
  sourceDocument: "test fixture layout (not official ILSOS documentation)",
  requiredRoles: ["file_number", "legal_name"],
  fields: [
    {
      key: "file_number",
      label: "File number",
      start: 1,
      length: 8,
      role: "file_number",
      provenance: "operator_confirmed",
    },
    {
      key: "legal_name",
      label: "Legal name",
      start: 10,
      length: 60,
      role: "legal_name",
      provenance: "operator_confirmed",
    },
  ],
});

export function nameRecord(fileNumber: string, legalName: string): string {
  return pad(fileNumber, 8) + " " + pad(legalName, 60);
}

// --------------------------------------------------------------- AGENT file
// 1-8 file number | 10-49 agent name | 51-80 street | 82-101 city | 103-104 state | 106-110 zip
export const AGENT_RECORD_LENGTH = 110;

export const agentLayout = (family: "llc" | "cdx"): RecordLayout => ({
  key: `${family}-agent`,
  family,
  fileKind: "agent",
  version: 1,
  status: "confirmed",
  recordLength: AGENT_RECORD_LENGTH,
  header: { expectToken: `${family}allagt`, expectHeader: true },
  sourceDocument: "test fixture layout (not official ILSOS documentation)",
  requiredRoles: ["file_number", "agent_name"],
  fields: [
    { key: "file_number", label: "File number", start: 1, length: 8, role: "file_number", provenance: "operator_confirmed" },
    { key: "agent_name", label: "Agent name", start: 10, length: 40, role: "agent_name", provenance: "operator_confirmed" },
    { key: "agent_street", label: "Agent street", start: 51, length: 30, role: "agent_street", provenance: "operator_confirmed" },
    { key: "agent_city", label: "Agent city", start: 82, length: 20, role: "agent_city", provenance: "operator_confirmed" },
    { key: "agent_state", label: "Agent state", start: 103, length: 2, role: "agent_state", provenance: "operator_confirmed" },
    { key: "agent_zip", label: "Agent ZIP", start: 106, length: 5, role: "agent_zip", provenance: "operator_confirmed" },
  ],
});

export function agentRecord(
  fileNumber: string,
  agentName: string,
  street = "100 MAIN ST",
  city = "CHICAGO",
  state = "IL",
  zip = "60601",
): string {
  return (
    pad(fileNumber, 8) +
    " " +
    pad(agentName, 40) +
    " " +
    pad(street, 30) +
    " " +
    pad(city, 20) +
    " " +
    pad(state, 2) +
    " " +
    pad(zip, 5)
  );
}

// -------------------------------------------------------------- MASTER file
// 1-8 file number | 10-11 status code (undocumented) | 13-20 organization date
export const MASTER_RECORD_LENGTH = 20;

export const masterLayout = (family: "llc" | "cdx"): RecordLayout => ({
  key: `${family}-master`,
  family,
  fileKind: "master",
  version: 1,
  status: "confirmed",
  recordLength: MASTER_RECORD_LENGTH,
  header: { expectToken: `${family}allmst`, expectHeader: true },
  sourceDocument: "test fixture layout (not official ILSOS documentation)",
  requiredRoles: ["file_number"],
  fields: [
    { key: "file_number", label: "File number", start: 1, length: 8, role: "file_number", provenance: "operator_confirmed" },
    {
      key: "status_code",
      label: "Status code",
      start: 10,
      length: 2,
      role: "status_code",
      provenance: "operator_confirmed",
      notes: "Code values are not documented in this build; the raw code is retained.",
    },
    {
      key: "organization_date",
      label: "Organization date",
      start: 13,
      length: 8,
      role: "organization_date",
      provenance: "operator_confirmed",
    },
  ],
});

export function masterRecord(
  fileNumber: string,
  statusCode = "AC",
  organizationDate = "19980415",
): string {
  return pad(fileNumber, 8) + " " + pad(statusCode, 2) + " " + pad(organizationDate, 8);
}

export function header(token: string, runDate = "09/01/2026"): string {
  return `${token.toUpperCase()}  ${runDate}  ILLINOIS SECRETARY OF STATE`;
}

export function toStream(lines: string[]): Readable {
  return Readable.from([Buffer.from(lines.join("\r\n") + "\r\n", "latin1")]);
}

/** A complete, joinable three-file LLC bundle used across the import tests. */
export const SAMPLE_LLC_BUNDLE = {
  name: [
    header("llcallnam"),
    nameRecord("00100001", "LAKE SHORE CONDOMINIUM ASSOCIATION"),
    nameRecord("00100002", "WILLOW CREEK HOMEOWNERS ASSOCIATION"),
    nameRecord("00100003", "PRAIRIE FARMERS COOPERATIVE"),
    nameRecord("00100004", "SUNSET RIDGE H.O.A."),
    nameRecord("00100005", "ACME WIDGETS COMPANY"),
  ],
  agent: [
    header("llcallagt"),
    agentRecord("00100001", "COSTELLO SURY & ROONEY, P.C."),
    agentRecord("00100002", "COSTELLO SURY & ROONEY PC"),
    agentRecord("00100003", "SOME OTHER AGENT LLC"),
    // 00100004 deliberately has no agent record.
    agentRecord("00100005", "ACME MANAGEMENT LLC"),
  ],
  master: [
    header("llcallmst"),
    masterRecord("00100001"),
    masterRecord("00100002"),
    masterRecord("00100003"),
    masterRecord("00100004"),
    masterRecord("00100005"),
  ],
};
